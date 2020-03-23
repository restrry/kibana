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

import { BehaviorSubject } from 'rxjs';
import { take } from 'rxjs/operators';
import { renderHook, act } from '@testing-library/react-hooks';

import { EUI_CHARTS_THEME_DARK, EUI_CHARTS_THEME_LIGHT } from '@elastic/eui/dist/eui_charts_theme';

import { ThemeService } from './theme';
import { coreMock } from '../../../../../core/public/mocks';

const { uiSettings: setupMockUiSettings } = coreMock.createSetup();

describe('ThemeService', () => {
  describe('chartsTheme$', () => {
    it('should throw error if service has not been initialized', () => {
      const themeService = new ThemeService();
      expect(() => themeService.chartsTheme$).toThrowError();
    });
    it('returns the light theme when not in dark mode', async () => {
      setupMockUiSettings.get$.mockReturnValue(new BehaviorSubject(false));
      const themeService = new ThemeService();
      themeService.init(setupMockUiSettings);

      expect(await themeService.chartsTheme$.pipe(take(1)).toPromise()).toEqual(
        EUI_CHARTS_THEME_LIGHT.theme
      );
    });

    describe('in dark mode', () => {
      it(`returns the dark theme`, async () => {
        // Fake dark theme turned returning true
        setupMockUiSettings.get$.mockReturnValue(new BehaviorSubject(true));
        const themeService = new ThemeService();
        themeService.init(setupMockUiSettings);

        expect(await themeService.chartsTheme$.pipe(take(1)).toPromise()).toEqual(
          EUI_CHARTS_THEME_DARK.theme
        );
      });
    });
  });

  describe('useChartsTheme', () => {
    it('updates when the uiSettings change', () => {
      const darkMode$ = new BehaviorSubject(false);
      setupMockUiSettings.get$.mockReturnValue(darkMode$);
      const themeService = new ThemeService();
      themeService.init(setupMockUiSettings);
      const { useChartsTheme } = themeService;

      const { result } = renderHook(() => useChartsTheme());
      expect(result.current).toBe(EUI_CHARTS_THEME_LIGHT.theme);

      act(() => darkMode$.next(true));
      expect(result.current).toBe(EUI_CHARTS_THEME_DARK.theme);
      act(() => darkMode$.next(false));
      expect(result.current).toBe(EUI_CHARTS_THEME_LIGHT.theme);
    });
  });
});
