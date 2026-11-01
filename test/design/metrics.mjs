/** Размеры из макетов Paper: упадёт тест — значит, вёрстка разошлась с листом. tol — допуск в пикселях (по умолчанию 1). */
const shell = [
  { sel: '#sidebar', prop: 'x', want: 6 }, { sel: '#sidebar', prop: 'width', want: 256 },
  { sel: '.search-btn', prop: 'y', want: 120 }, { sel: '.search-btn', prop: 'height', want: 36 },
  { sel: '#sidebar .nav-item', prop: 'y', want: 172 },
];
export const METRICS = [
  { screen: 'A01', checks: [...shell,
    { sel: '.topbar h1', prop: 'fontSize', want: '32px' }, { sel: '.topbar h1', prop: 'lineHeight', want: '40px' },
    { sel: '.section-head h2', prop: 'y', want: 96 }, { sel: '.unit-card', prop: 'y', want: 140 }, { sel: '.unit-card', prop: 'height', want: 144 }, { sel: '.unit-card', prop: 'width', want: 367 },
    { sel: '.unit-card', prop: 'borderRadius', want: '28px' }] },
  { screen: 'A03', checks: [{ sel: '.lz-head h1', prop: 'fontSize', want: '24px' }, { sel: '.lz-crumb', prop: 'fontSize', want: '12px' }, { sel: '.lz-right', prop: 'width', want: 456 }, { sel: '.lb', prop: 'height', want: 66 }, { sel: '.lz-mode .lz-list', prop: 'borderRadius', want: '24px' }] },
  { screen: 'A07', checks: [{ sel: '.palette', prop: 'width', want: 640 }, { sel: '.pal-item', prop: 'height', want: 44 }] },
  { screen: 'A09', checks: [{ sel: '.topbar h1', prop: 'fontSize', want: '32px' }, { sel: '.cs', prop: 'y', want: 96 }, { sel: '.cs', prop: 'height', want: 100 }, { sel: '.cs', prop: 'width', want: 217 }, { sel: '.an-grid > section', prop: 'y', want: 216 }, { sel: '.an-grid > section', prop: 'height', want: 292 }, { sel: '.an-grid > section', prop: 'width', want: 560 }, { sel: '.an-tools .seg', prop: 'height', want: 44 }] },
  { screen: 'B01', checks: [{ sel: '.topbar h1', prop: 'fontSize', want: '24px' }, { sel: '.tb-right .btn', prop: 'height', want: 36 }, { sel: '.apps-bar', prop: 'y', want: 94 }, { sel: '.ap-group .ap-row', prop: 'height', want: 56 }, { sel: '.ap-group-head', prop: 'height', want: 40 }] },
  { screen: 'B04', checks: [{ sel: '.panel', prop: 'width', want: 840 }, { sel: '.ap-props select.inp', prop: 'height', want: 40 }] },
  { screen: 'B05', checks: [{ sel: '.topbar h1', prop: 'fontSize', want: '32px' }, { sel: '.app-page .up-body > section', prop: 'x', want: 286 }, { sel: '.app-page .up-body > section', prop: 'width', want: 776 }, { sel: '.app-side', prop: 'width', want: 340 }, { sel: '.app-side', prop: 'x', want: 1078 }, { sel: '.up-head h3', prop: 'fontSize', want: '18px' }, { sel: '.up-head h3', prop: 'lineHeight', want: '22px' }] },
  { screen: 'C02', checks: [{ sel: '.unit-head h1', prop: 'fontSize', want: '24px' }, { sel: '.cs', prop: 'height', want: 100 }, { sel: '.cs', prop: 'y', want: 149 }] },
  { screen: 'C03', checks: [{ sel: '.col', prop: 'borderRadius', want: '28px' }] },
  { screen: 'D01', checks: [{ sel: '.panel-main .cl-item input', prop: 'width', want: 20 }, { sel: '.panel-main .cl-item input', prop: 'height', want: 20 }] },
  { screen: 'D05', checks: [{ sel: '.modal', prop: 'width', want: 480 }] },
  { screen: 'F03', checks: [{ sel: '.prefs-nav', prop: 'y', want: 96 }, { sel: '.prefs-nav', prop: 'x', want: 286 }, { sel: '.prefs-body', prop: 'y', want: 153, tol: 2 }] },
];
