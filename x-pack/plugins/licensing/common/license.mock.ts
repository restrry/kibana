/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import { PublicLicense } from './types';
import { License } from './license';

function createLicense({
  license = {},
  features = {},
  signature = 'xxxxxxxxx',
}: {
  license?: Partial<PublicLicense['license']>;
  features?: PublicLicense['features'];
  signature?: string;
} = {}) {
  const defaultLicense = {
    uid: 'uid-000000001234',
    status: 'active',
    type: 'basic',
    expiryDateInMillis: 5000,
  };

  const defaultFeatures = {
    ccr: {
      enabled: true,
      available: true,
    },
    ml: {
      enabled: false,
      available: true,
    },
  };
  return new License({
    license: Object.assign(defaultLicense, license),
    features: Object.assign(defaultFeatures, features),
    signature,
  });
}

export const licenseMock = {
  create: createLicense,
};
