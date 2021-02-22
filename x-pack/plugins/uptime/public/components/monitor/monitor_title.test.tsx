/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import moment from 'moment';
import * as reactRouterDom from 'react-router-dom';
import { Ping } from '../../../common/runtime_types';
import { MonitorPageTitle } from './monitor_title';
import { renderWithRouter } from '../../lib/helper/mocks';
import { mockReduxHooks } from '../../lib/helper/test_helpers';

jest.mock('react-router-dom', () => {
  const originalModule = jest.requireActual('react-router-dom');

  return {
    ...originalModule,
    useParams: jest.fn(),
  };
});

export function mockReactRouterDomHooks({ useParamsResponse }: { useParamsResponse: any }) {
  jest.spyOn(reactRouterDom, 'useParams').mockReturnValue(useParamsResponse);
}

describe('MonitorTitle component', () => {
  const monitorName = 'sample monitor';
  const defaultMonitorId = 'always-down';
  const defaultMonitorIdEncoded = 'YWx3YXlzLWRvd24'; // resolves to always-down
  const autoGeneratedMonitorIdEncoded = 'YXV0by1pY21wLTBYMjQ5NDhGNDY3QzZDNEYwMQ'; // resolves to auto-icmp-0X24948F467C6C4F01

  const defaultMonitorStatus: Ping = {
    docId: 'few213kl',
    timestamp: moment(new Date()).subtract(15, 'm').toString(),
    monitor: {
      duration: {
        us: 1234567,
      },
      id: defaultMonitorId,
      status: 'up',
      type: 'http',
    },
    url: {
      full: 'https://www.elastic.co/',
    },
  };

  const monitorStatusWithName: Ping = {
    ...defaultMonitorStatus,
    monitor: {
      ...defaultMonitorStatus.monitor,
      name: monitorName,
    },
  };

  beforeEach(() => {
    mockReactRouterDomHooks({ useParamsResponse: { monitorId: defaultMonitorIdEncoded } });
    mockReduxHooks(defaultMonitorStatus);
  });

  it('renders the monitor heading and EnableMonitorAlert toggle', () => {
    mockReduxHooks(monitorStatusWithName);
    const component = renderWithRouter(<MonitorPageTitle />);
    expect(component.find('h1').text()).toBe(monitorName);
    expect(component.find('[data-test-subj="uptimeDisplayDefineConnector"]').length).toBe(1);
  });

  it('renders the user provided monitorId when the name is not present', () => {
    mockReactRouterDomHooks({ useParamsResponse: { monitorId: defaultMonitorIdEncoded } });
    const component = renderWithRouter(<MonitorPageTitle />);
    expect(component.find('h1').text()).toBe(defaultMonitorId);
  });

  it('renders the url when the monitorId is auto generated and the monitor name is not present', () => {
    mockReactRouterDomHooks({ useParamsResponse: { monitorId: autoGeneratedMonitorIdEncoded } });
    const component = renderWithRouter(<MonitorPageTitle />);
    expect(component.find('h1').text()).toBe(defaultMonitorStatus.url?.full);
  });
});
