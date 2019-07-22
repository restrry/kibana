/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { errors } from 'elasticsearch';
import sinon from 'sinon';

import { httpServerMock } from '../../../../../../src/core/server/mocks';
import { mockAuthenticatedUser } from '../../../common/model/authenticated_user.mock';
import { MockAuthenticationProviderOptions, mockAuthenticationProviderOptions } from './base.mock';

import { KerberosAuthenticationProvider } from './kerberos';
import { ElasticsearchErrorHelpers } from '../../../../../../src/core/server/elasticsearch';

describe('KerberosAuthenticationProvider', () => {
  let provider: KerberosAuthenticationProvider;
  let mockOptions: MockAuthenticationProviderOptions;
  beforeEach(() => {
    mockOptions = mockAuthenticationProviderOptions();
    provider = new KerberosAuthenticationProvider(mockOptions);
  });

  describe('`authenticate` method', () => {
    it('does not handle `authorization` header with unsupported schema even if state contains a valid token.', async () => {
      const request = httpServerMock.createKibanaRequest({
        headers: { authorization: 'Basic some:credentials' },
      });
      const tokenPair = {
        accessToken: 'some-valid-token',
        refreshToken: 'some-valid-refresh-token',
      };

      const authenticationResult = await provider.authenticate(request, tokenPair);

      sinon.assert.notCalled(mockOptions.client.callWithRequest);
      sinon.assert.notCalled(mockOptions.client.callWithInternalUser);
      expect(request.headers.authorization).toBe('Basic some:credentials');
      expect(authenticationResult.notHandled()).toBe(true);
    });

    it('does not handle requests that can be authenticated without `Negotiate` header.', async () => {
      const request = httpServerMock.createKibanaRequest();

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({
            headers: { authorization: `Negotiate ${Buffer.from('__fake__').toString('base64')}` },
          }),
          'shield.authenticate'
        )
        .resolves({});

      const authenticationResult = await provider.authenticate(request, null);

      expect(authenticationResult.notHandled()).toBe(true);
    });

    it('does not handle requests if backend does not support Kerberos.', async () => {
      const request = httpServerMock.createKibanaRequest();
      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({
            headers: { authorization: `Negotiate ${Buffer.from('__fake__').toString('base64')}` },
          }),
          'shield.authenticate'
        )
        .rejects(ElasticsearchErrorHelpers.decorateNotAuthorizedError(new Error()));

      const authenticationResult = await provider.authenticate(request, null);
      expect(authenticationResult.notHandled()).toBe(true);
    });

    it('fails if state is present, but backend does not support Kerberos.', async () => {
      const request = httpServerMock.createKibanaRequest();
      const tokenPair = { accessToken: 'token', refreshToken: 'refresh-token' };

      mockOptions.client.callWithRequest
        .withArgs(sinon.match.any, 'shield.authenticate')
        .rejects(ElasticsearchErrorHelpers.decorateNotAuthorizedError(new Error()));

      mockOptions.tokens.refresh.withArgs(tokenPair.refreshToken).resolves(null);

      const authenticationResult = await provider.authenticate(request, tokenPair);
      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toHaveProperty('output.statusCode', 401);
      expect(authenticationResult.challenges).toBeUndefined();
    });

    it('fails with `Negotiate` challenge if backend supports Kerberos.', async () => {
      const request = httpServerMock.createKibanaRequest();
      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({
            headers: { authorization: `Negotiate ${Buffer.from('__fake__').toString('base64')}` },
          }),
          'shield.authenticate'
        )
        .rejects(
          ElasticsearchErrorHelpers.decorateNotAuthorizedError(
            new (errors.AuthenticationException as any)('Unauthorized', {
              body: { error: { header: { 'WWW-Authenticate': 'Negotiate' } } },
            })
          )
        );

      const authenticationResult = await provider.authenticate(request, null);

      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toHaveProperty('output.statusCode', 401);
      expect(authenticationResult.challenges).toEqual(['Negotiate']);
    });

    it('fails if request authentication is failed with non-401 error.', async () => {
      const request = httpServerMock.createKibanaRequest();

      mockOptions.client.callWithRequest
        .withArgs(sinon.match.any, 'shield.authenticate')
        .rejects(new errors.ServiceUnavailable());

      const authenticationResult = await provider.authenticate(request, null);

      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toHaveProperty('status', 503);
      expect(authenticationResult.challenges).toBeUndefined();
    });

    it('gets an token pair in exchange to SPNEGO one and stores it in the state.', async () => {
      const user = mockAuthenticatedUser();
      const request = httpServerMock.createKibanaRequest({
        headers: { authorization: 'negotiate spnego' },
      });

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: 'Bearer some-token' } }),
          'shield.authenticate'
        )
        .resolves(user);

      mockOptions.client.callWithInternalUser
        .withArgs('shield.getAccessToken')
        .resolves({ access_token: 'some-token', refresh_token: 'some-refresh-token' });

      const authenticationResult = await provider.authenticate(request);

      sinon.assert.calledWithExactly(
        mockOptions.client.callWithInternalUser,
        'shield.getAccessToken',
        { body: { grant_type: '_kerberos', kerberos_ticket: 'spnego' } }
      );

      expect(request.headers.authorization).toBe('negotiate spnego');
      expect(authenticationResult.succeeded()).toBe(true);
      expect(authenticationResult.user).toBe(user);
      expect(authenticationResult.authHeaders).toEqual({ authorization: 'Bearer some-token' });
      expect(authenticationResult.state).toEqual({
        accessToken: 'some-token',
        refreshToken: 'some-refresh-token',
      });
    });

    it('fails if could not retrieve an access token in exchange to SPNEGO one.', async () => {
      const request = httpServerMock.createKibanaRequest({
        headers: { authorization: 'negotiate spnego' },
      });

      const failureReason = ElasticsearchErrorHelpers.decorateNotAuthorizedError(new Error());
      mockOptions.client.callWithInternalUser
        .withArgs('shield.getAccessToken')
        .rejects(failureReason);

      const authenticationResult = await provider.authenticate(request);

      sinon.assert.calledWithExactly(
        mockOptions.client.callWithInternalUser,
        'shield.getAccessToken',
        { body: { grant_type: '_kerberos', kerberos_ticket: 'spnego' } }
      );

      expect(request.headers.authorization).toBe('negotiate spnego');
      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toBe(failureReason);
      expect(authenticationResult.challenges).toBeUndefined();
    });

    it('fails if could not retrieve user using the new access token.', async () => {
      const request = httpServerMock.createKibanaRequest({
        headers: { authorization: 'negotiate spnego' },
      });

      const failureReason = ElasticsearchErrorHelpers.decorateNotAuthorizedError(new Error());
      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: 'Bearer some-token' } }),
          'shield.authenticate'
        )
        .rejects(failureReason);

      mockOptions.client.callWithInternalUser
        .withArgs('shield.getAccessToken')
        .resolves({ access_token: 'some-token', refresh_token: 'some-refresh-token' });

      const authenticationResult = await provider.authenticate(request);

      sinon.assert.calledWithExactly(
        mockOptions.client.callWithInternalUser,
        'shield.getAccessToken',
        { body: { grant_type: '_kerberos', kerberos_ticket: 'spnego' } }
      );

      expect(request.headers.authorization).toBe('negotiate spnego');
      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toBe(failureReason);
      expect(authenticationResult.challenges).toBeUndefined();
    });

    it('succeeds if state contains a valid token.', async () => {
      const user = mockAuthenticatedUser();
      const request = httpServerMock.createKibanaRequest();
      const tokenPair = {
        accessToken: 'some-valid-token',
        refreshToken: 'some-valid-refresh-token',
      };

      const authorization = `Bearer ${tokenPair.accessToken}`;
      mockOptions.client.callWithRequest
        .withArgs(sinon.match({ headers: { authorization } }), 'shield.authenticate')
        .resolves(user);

      const authenticationResult = await provider.authenticate(request, tokenPair);

      expect(request.headers).not.toHaveProperty('authorization');
      expect(authenticationResult.succeeded()).toBe(true);
      expect(authenticationResult.authHeaders).toEqual({ authorization });
      expect(authenticationResult.user).toBe(user);
      expect(authenticationResult.state).toBeUndefined();
    });

    it('succeeds with valid session even if requiring a token refresh', async () => {
      const user = mockAuthenticatedUser();
      const request = httpServerMock.createKibanaRequest();
      const tokenPair = { accessToken: 'foo', refreshToken: 'bar' };

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: `Bearer ${tokenPair.accessToken}` } }),
          'shield.authenticate'
        )
        .rejects(ElasticsearchErrorHelpers.decorateNotAuthorizedError(new Error()));

      mockOptions.tokens.refresh
        .withArgs(tokenPair.refreshToken)
        .resolves({ accessToken: 'newfoo', refreshToken: 'newbar' });

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: 'Bearer newfoo' } }),
          'shield.authenticate'
        )
        .resolves(user);

      const authenticationResult = await provider.authenticate(request, tokenPair);

      sinon.assert.calledOnce(mockOptions.tokens.refresh);

      expect(authenticationResult.succeeded()).toBe(true);
      expect(authenticationResult.authHeaders).toEqual({ authorization: 'Bearer newfoo' });
      expect(authenticationResult.user).toEqual(user);
      expect(authenticationResult.state).toEqual({ accessToken: 'newfoo', refreshToken: 'newbar' });
      expect(request.headers).not.toHaveProperty('authorization');
    });

    it('fails if token from the state is rejected because of unknown reason.', async () => {
      const request = httpServerMock.createKibanaRequest();
      const tokenPair = {
        accessToken: 'some-valid-token',
        refreshToken: 'some-valid-refresh-token',
      };

      const failureReason = new errors.InternalServerError('Token is not valid!');

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: `Bearer ${tokenPair.accessToken}` } }),
          'shield.authenticate'
        )
        .rejects(failureReason);

      const authenticationResult = await provider.authenticate(request, tokenPair);

      expect(request.headers).not.toHaveProperty('authorization');
      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toBe(failureReason);
      sinon.assert.neverCalledWith(
        mockOptions.client.callWithRequest,
        sinon.match.any,
        'shield.getAccessToken'
      );
    });

    it('fails with `Negotiate` challenge if both access and refresh tokens from the state are expired and backend supports Kerberos.', async () => {
      const request = httpServerMock.createKibanaRequest();
      const tokenPair = { accessToken: 'expired-token', refreshToken: 'some-valid-refresh-token' };

      mockOptions.client.callWithRequest.withArgs(sinon.match.any, 'shield.authenticate').rejects(
        ElasticsearchErrorHelpers.decorateNotAuthorizedError(
          new (errors.AuthenticationException as any)('Unauthorized', {
            body: { error: { header: { 'WWW-Authenticate': 'Negotiate' } } },
          })
        )
      );

      mockOptions.tokens.refresh.withArgs(tokenPair.refreshToken).resolves(null);

      const authenticationResult = await provider.authenticate(request, tokenPair);

      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toHaveProperty('output.statusCode', 401);
      expect(authenticationResult.challenges).toEqual(['Negotiate']);
    });

    it('fails with `Negotiate` challenge if both access and refresh token documents are missing and backend supports Kerberos.', async () => {
      const request = httpServerMock.createKibanaRequest({ headers: {} });
      const tokenPair = { accessToken: 'missing-token', refreshToken: 'missing-refresh-token' };

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: `Bearer ${tokenPair.accessToken}` } }),
          'shield.authenticate'
        )
        .rejects({
          statusCode: 500,
          body: { error: { reason: 'token document is missing and must be present' } },
        });

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({
            headers: { authorization: `Negotiate ${Buffer.from('__fake__').toString('base64')}` },
          }),
          'shield.authenticate'
        )
        .rejects(
          ElasticsearchErrorHelpers.decorateNotAuthorizedError(
            new (errors.AuthenticationException as any)('Unauthorized', {
              body: { error: { header: { 'WWW-Authenticate': 'Negotiate' } } },
            })
          )
        );

      mockOptions.tokens.refresh.withArgs(tokenPair.refreshToken).resolves(null);

      const authenticationResult = await provider.authenticate(request, tokenPair);

      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toHaveProperty('output.statusCode', 401);
      expect(authenticationResult.challenges).toEqual(['Negotiate']);
    });

    it('succeeds if `authorization` contains a valid token.', async () => {
      const user = mockAuthenticatedUser();
      const request = httpServerMock.createKibanaRequest({
        headers: { authorization: 'Bearer some-valid-token' },
      });

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: 'Bearer some-valid-token' } }),
          'shield.authenticate'
        )
        .resolves(user);

      const authenticationResult = await provider.authenticate(request);

      expect(request.headers.authorization).toBe('Bearer some-valid-token');
      expect(authenticationResult.succeeded()).toBe(true);
      expect(authenticationResult.authHeaders).toBeUndefined();
      expect(authenticationResult.user).toBe(user);
      expect(authenticationResult.state).toBeUndefined();
    });

    it('fails if token from `authorization` header is rejected.', async () => {
      const request = httpServerMock.createKibanaRequest({
        headers: { authorization: 'Bearer some-invalid-token' },
      });

      const failureReason = ElasticsearchErrorHelpers.decorateNotAuthorizedError(new Error());
      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: 'Bearer some-invalid-token' } }),
          'shield.authenticate'
        )
        .rejects(failureReason);

      const authenticationResult = await provider.authenticate(request);

      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toBe(failureReason);
    });

    it('fails if token from `authorization` header is rejected even if state contains a valid one.', async () => {
      const user = mockAuthenticatedUser();
      const request = httpServerMock.createKibanaRequest({
        headers: { authorization: 'Bearer some-invalid-token' },
      });
      const tokenPair = {
        accessToken: 'some-valid-token',
        refreshToken: 'some-valid-refresh-token',
      };

      const failureReason = ElasticsearchErrorHelpers.decorateNotAuthorizedError(new Error());

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: 'Bearer some-invalid-token' } }),
          'shield.authenticate'
        )
        .rejects(failureReason);

      mockOptions.client.callWithRequest
        .withArgs(
          sinon.match({ headers: { authorization: `Bearer ${tokenPair.accessToken}` } }),
          'shield.authenticate'
        )
        .resolves(user);

      const authenticationResult = await provider.authenticate(request, tokenPair);

      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toBe(failureReason);
    });
  });

  describe('`logout` method', () => {
    it('returns `notHandled` if state is not presented.', async () => {
      const request = httpServerMock.createKibanaRequest();

      let deauthenticateResult = await provider.logout(request);
      expect(deauthenticateResult.notHandled()).toBe(true);

      deauthenticateResult = await provider.logout(request, null);
      expect(deauthenticateResult.notHandled()).toBe(true);

      sinon.assert.notCalled(mockOptions.tokens.invalidate);
    });

    it('fails if `tokens.invalidate` fails', async () => {
      const request = httpServerMock.createKibanaRequest();
      const tokenPair = { accessToken: 'foo', refreshToken: 'bar' };

      const failureReason = new Error('failed to delete token');
      mockOptions.tokens.invalidate.withArgs(tokenPair).rejects(failureReason);

      const authenticationResult = await provider.logout(request, tokenPair);

      sinon.assert.calledOnce(mockOptions.tokens.invalidate);
      sinon.assert.calledWithExactly(mockOptions.tokens.invalidate, tokenPair);

      expect(authenticationResult.failed()).toBe(true);
      expect(authenticationResult.error).toBe(failureReason);
    });

    it('redirects to `/logged_out` page if tokens are invalidated successfully.', async () => {
      const request = httpServerMock.createKibanaRequest();
      const tokenPair = {
        accessToken: 'some-valid-token',
        refreshToken: 'some-valid-refresh-token',
      };

      mockOptions.tokens.invalidate.withArgs(tokenPair).resolves();

      const authenticationResult = await provider.logout(request, tokenPair);

      sinon.assert.calledOnce(mockOptions.tokens.invalidate);
      sinon.assert.calledWithExactly(mockOptions.tokens.invalidate, tokenPair);

      expect(authenticationResult.redirected()).toBe(true);
      expect(authenticationResult.redirectURL).toBe('/logged_out');
    });
  });
});
