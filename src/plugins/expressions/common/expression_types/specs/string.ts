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

import { ExpressionTypeDefinition } from '../types';
import { Datatable } from './datatable';
import { ExpressionValueRender } from './render';

const name = 'string';

export const string: ExpressionTypeDefinition<typeof name, string> = {
  name,
  from: {
    null: () => '',
    boolean: (b) => String(b),
    number: (n) => String(n),
  },
  to: {
    render: <T>(text: T): ExpressionValueRender<{ text: T }> => {
      return {
        type: 'render',
        as: 'text',
        value: { text },
      };
    },
    datatable: (value): Datatable => ({
      type: 'datatable',
      columns: [{ name: 'value', type: 'string' }],
      rows: [{ value }],
    }),
  },
};
