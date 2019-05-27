/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { Request, Server, ServerOptions } from 'hapi';

import { modifyUrl } from '../../utils';
import { Logger } from '../logging';
import { HttpConfig } from './http_config';
import { createServer, getServerOptions } from './http_tools';
import { adoptToHapiAuthFormat, AuthenticationHandler } from './lifecycle/auth';
import { adoptToHapiOnPostAuthFormat, OnPostAuthHandler } from './lifecycle/on_post_auth';
import { adoptToHapiOnPreAuthFormat, OnPreAuthHandler } from './lifecycle/on_pre_auth';
import { adoptToHapiOnPreResponseFormat, OnPreResponseHandler } from './lifecycle/on_pre_response';
import { Router, KibanaRequest } from './router';
import {
  SessionStorageCookieOptions,
  createCookieSessionStorageFactory,
} from './cookie_session_storage';

enum AuthStatus {
  authenticated = 'authenticated',
  unauthenticated = 'unauthenticated',
  unknown = 'unknown',
}

export interface HttpServerSetup {
  server: Server;
  options: ServerOptions;
  registerRouter: (router: Router) => void;
  /**
   * Define custom authentication and/or authorization mechanism for incoming requests.
   * Applied to all resources by default. Only one AuthenticationHandler can be registered.
   */
  registerAuth: <T>(
    authenticationHandler: AuthenticationHandler<T>,
    cookieOptions: SessionStorageCookieOptions<T>
  ) => Promise<void>;
  /**
   * Define custom logic to perform for incoming requests.
   * Applied to all resources by default.
   * Can register any number of OnRequestHandlers, which are called in sequence (from the first registered to the last)
   */
  registerOnPreAuth: (requestHandler: OnPreAuthHandler) => void;
  registerOnPostAuth: (requestHandler: OnPostAuthHandler) => void;
  registerOnPreResponse: (handler: OnPreResponseHandler) => void;
  getBasePathFor: (request: KibanaRequest | Request) => string;
  setBasePathFor: (request: KibanaRequest | Request, basePath: string) => void;
  auth: {
    get: (
      request: KibanaRequest | Request
    ) => {
      status: AuthStatus;
      state: unknown;
    };
    isAuthenticated: (request: KibanaRequest | Request) => boolean;
  };
}

export class HttpServer {
  private server?: Server;
  private registeredRouters = new Set<Router>();
  private authRegistered = false;
  private basePathCache = new WeakMap<
    ReturnType<KibanaRequest['unstable_getIncomingMessage']>,
    string
  >();

  private authState = new WeakMap<
    ReturnType<KibanaRequest['unstable_getIncomingMessage']>,
    unknown
  >();

  constructor(private readonly log: Logger) {}

  public isListening() {
    return this.server !== undefined && this.server.listener.listening;
  }

  private registerRouter(router: Router) {
    if (this.isListening()) {
      throw new Error('Routers can be registered only when HTTP server is stopped.');
    }

    this.log.debug(`registering route handler for [${router.path}]`);
    this.registeredRouters.add(router);
  }

  // passing hapi Request works for BWC. can be deleted once we remove legacy server.
  private getBasePathFor(config: HttpConfig, request: KibanaRequest | Request) {
    const incomingMessage =
      request instanceof KibanaRequest ? request.unstable_getIncomingMessage() : request.raw.req;

    const requestScopePath = this.basePathCache.get(incomingMessage) || '';
    const serverBasePath = config.basePath || '';
    return `${serverBasePath}${requestScopePath}`;
  }

  // should work only for KibanaRequest as soon as spaces migrate to NP
  private setBasePathFor(request: KibanaRequest | Request, basePath: string) {
    const incomingMessage =
      request instanceof KibanaRequest ? request.unstable_getIncomingMessage() : request.raw.req;
    if (this.basePathCache.has(incomingMessage)) {
      throw new Error(
        'Request basePath was previously set. Setting multiple times is not supported.'
      );
    }
    this.basePathCache.set(incomingMessage, basePath);
  }

  public setup(config: HttpConfig): HttpServerSetup {
    const serverOptions = getServerOptions(config);
    this.server = createServer(serverOptions);

    this.setupBasePathRewrite(config);

    return {
      options: serverOptions,
      registerRouter: this.registerRouter.bind(this),
      registerOnPreAuth: this.registerOnPreAuth.bind(this),
      registerOnPostAuth: this.registerOnPostAuth.bind(this),
      registerAuth: <T>(
        fn: AuthenticationHandler<T>,
        cookieOptions: SessionStorageCookieOptions<T>
      ) => this.registerAuth(fn, cookieOptions, config.basePath),
      registerOnPreResponse: this.registerOnPreResponse.bind(this),
      getBasePathFor: this.getBasePathFor.bind(this, config),
      setBasePathFor: this.setBasePathFor.bind(this),
      auth: {
        get: this.getAuthData.bind(this),
        isAuthenticated: this.isAuthenticated.bind(this),
      },
      // Return server instance with the connection options so that we can properly
      // bridge core and the "legacy" Kibana internally. Once this bridge isn't
      // needed anymore we shouldn't return the instance from this method.
      server: this.server,
    };
  }

  public async start(config: HttpConfig) {
    if (this.server === undefined) {
      throw new Error('Http server is not setup up yet');
    }
    this.log.debug('starting http server');

    for (const router of this.registeredRouters) {
      for (const route of router.getRoutes()) {
        const isAuthRequired = Boolean(this.authRegistered && route.authRequired);
        this.server.route({
          handler: route.handler,
          method: route.method,
          path: this.getRouteFullPath(router.path, route.path),
          options: {
            auth: isAuthRequired ? undefined : false,
          },
        });
      }
    }

    await this.server.start();

    this.log.debug(
      `http server running at ${this.server.info.uri}${
        config.rewriteBasePath ? config.basePath : ''
      }`
    );
  }

  public async stop() {
    if (this.server === undefined) {
      return;
    }

    this.log.debug('stopping http server');
    await this.server.stop();
    this.server = undefined;
  }

  private setupBasePathRewrite(config: HttpConfig) {
    if (config.basePath === undefined || !config.rewriteBasePath) {
      return;
    }

    const basePath = config.basePath;
    this.registerOnPreAuth((request, toolkit) => {
      const newURL = modifyUrl(request.url.href!, urlParts => {
        if (urlParts.pathname != null && urlParts.pathname.startsWith(basePath)) {
          urlParts.pathname = urlParts.pathname.replace(basePath, '') || '/';
        } else {
          return {};
        }
      });

      if (!newURL) {
        return toolkit.rejected(new Error('not found'), { statusCode: 404 });
      }

      return toolkit.redirected(newURL, { forward: true });
    });
  }

  private getRouteFullPath(routerPath: string, routePath: string) {
    // If router's path ends with slash and route's path starts with slash,
    // we should omit one of them to have a valid concatenated path.
    const routePathStartIndex = routerPath.endsWith('/') && routePath.startsWith('/') ? 1 : 0;
    return `${routerPath}${routePath.slice(routePathStartIndex)}`;
  }

  private registerOnPostAuth(fn: OnPostAuthHandler) {
    if (this.server === undefined) {
      throw new Error('Server is not created yet');
    }

    this.server.ext('onPostAuth', adoptToHapiOnPostAuthFormat(fn));
  }

  private registerOnPreAuth(fn: OnPreAuthHandler) {
    if (this.server === undefined) {
      throw new Error('Server is not created yet');
    }

    this.server.ext('onRequest', adoptToHapiOnPreAuthFormat(fn));
  }

  private registerOnPreResponse(fn: OnPreResponseHandler) {
    if (this.server === undefined) {
      throw new Error('Server is not created yet');
    }

    this.server.ext('onPreResponse', adoptToHapiOnPreResponseFormat(fn));
  }

  private async registerAuth<T>(
    fn: AuthenticationHandler<T>,
    cookieOptions: SessionStorageCookieOptions<T>,
    basePath?: string
  ) {
    if (this.server === undefined) {
      throw new Error('Server is not created yet');
    }
    if (this.authRegistered) {
      throw new Error('Auth interceptor was already registered');
    }
    this.authRegistered = true;

    const sessionStorage = await createCookieSessionStorageFactory<T>(
      this.server,
      cookieOptions,
      basePath
    );

    this.server.auth.scheme('login', () => ({
      authenticate: adoptToHapiAuthFormat(fn, sessionStorage, (req, state) => {
        this.authState.set(req.raw.req, state);
      }),
    }));
    this.server.auth.strategy('session', 'login');

    // The default means that the `session` strategy that is based on `login` schema defined above will be
    // automatically assigned to all routes that don't contain an auth config.
    // should be applied for all routes if they don't specify auth strategy in route declaration
    // https://github.com/hapijs/hapi/blob/master/API.md#-serverauthdefaultoptions
    this.server.auth.default('session');
  }
  private getAuthData(request: KibanaRequest | Request) {
    const incomingMessage =
      request instanceof KibanaRequest ? request.unstable_getIncomingMessage() : request.raw.req;

    const hasState = this.authState.has(incomingMessage);
    const state = this.authState.get(incomingMessage);
    const status: AuthStatus = hasState
      ? AuthStatus.authenticated
      : this.authRegistered
      ? AuthStatus.unauthenticated
      : AuthStatus.unknown;

    return { status, state };
  }
  private isAuthenticated(request: KibanaRequest | Request) {
    return this.getAuthData(request).status === AuthStatus.authenticated;
  }
}
