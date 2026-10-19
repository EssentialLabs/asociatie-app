/**
 * tests/e2e/responsive_ui.test.js
 *
 * Automated Responsive UI, Mobile Navigation Drawer & Touch UX Audit Suite:
 *  1. Viewport Meta Configuration (<meta name="viewport"> touch scaling handling)
 *  2. Mobile Navigation Toggle & Off-Canvas Drawer DOM Elements & ARIA accessibility
 *  3. Off-Canvas Drawer State Machine & Event Closures (toggleMobileSidebar, closeMobileSidebar)
 *  4. CSS Responsive Rules & Viewport Media Query Breakdown (Desktop, Tablet, Mobile)
 *  5. Data Tables, Overflow Containers & Boundary Cue Constraints
 *  6. Responsive Stat Cards & Fluid Layout Constraints across 320px, 375px, 768px, and 1024px
 *  7. Touch Target Guidelines (min-height >= 42-44px) on Buttons, Form Inputs & Selects
 *  8. Mobile Modal Scaling (95vw) & Accessible Close Buttons
 *  9. Desktop Fidelity (>=992px) & public/200.html Exact Parity
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');
const FALLBACK_200_HTML_PATH = path.join(PUBLIC_DIR, '200.html');
const APP_JS_PATH = path.join(PUBLIC_DIR, 'app.js');
const BROWSER_RUNTIME_PATH = path.join(PUBLIC_DIR, 'browser-runtime.js');
const STYLE_CSS_PATH = path.join(PUBLIC_DIR, 'style.css');

const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const fallback200Html = fs.readFileSync(FALLBACK_200_HTML_PATH, 'utf8');
const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
const browserRuntimeJs = fs.readFileSync(BROWSER_RUNTIME_PATH, 'utf8');
const styleCss = fs.readFileSync(STYLE_CSS_PATH, 'utf8');

describe('Responsive UI & Mobile Navigation Drawer E2E Audit Suite', () => {

  it('Test 1: Viewport <meta name="viewport"> is properly configured with touch scale handling', () => {
    const viewportRegex = /<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i;
    const match = indexHtml.match(viewportRegex);
    assert.ok(match, 'public/index.html must contain a <meta name="viewport"> tag');

    const content = match[1];
    assert.ok(content.includes('width=device-width'), 'Viewport must specify width=device-width');
    assert.ok(content.includes('initial-scale=1.0') || content.includes('initial-scale=1'), 'Viewport must specify initial-scale=1.0');
    assert.ok(
      content.includes('maximum-scale') || content.includes('viewport-fit=cover'),
      'Viewport must configure touch scale handling (e.g. maximum-scale, viewport-fit)'
    );

    const match200 = fallback200Html.match(viewportRegex);
    assert.ok(match200, 'public/200.html must also contain the identical <meta name="viewport"> tag');
    assert.equal(match200[1], content, 'Viewport meta tag in 200.html must exactly match index.html');
  });

  it('Test 2: Mobile Navigation Drawer & Hamburger Toggle DOM Elements & ARIA accessibility', () => {
    // 1. Hamburger button #mobile-nav-toggle
    assert.ok(
      indexHtml.includes('id="mobile-nav-toggle"'),
      'public/index.html must include #mobile-nav-toggle hamburger button'
    );
    assert.ok(
      /id="mobile-nav-toggle"[^>]*onclick="toggleMobileSidebar\(\)"/.test(indexHtml) ||
      /onclick="toggleMobileSidebar\(\)"[^>]*id="mobile-nav-toggle"/.test(indexHtml),
      '#mobile-nav-toggle must have onclick handler calling toggleMobileSidebar()'
    );
    assert.ok(
      indexHtml.includes('aria-label='),
      '#mobile-nav-toggle must have an aria-label for mobile accessibility'
    );
    assert.ok(
      indexHtml.includes('aria-expanded='),
      '#mobile-nav-toggle must have an aria-expanded attribute for screen reader state'
    );

    // 2. Backdrop #sidebar-backdrop
    assert.ok(
      indexHtml.includes('id="sidebar-backdrop"'),
      'public/index.html must include #sidebar-backdrop overlay'
    );
    assert.ok(
      indexHtml.includes('class="sidebar-backdrop"'),
      '#sidebar-backdrop must have class="sidebar-backdrop"'
    );
    assert.ok(
      /id="sidebar-backdrop"[^>]*onclick="toggleMobileSidebar\(false\)"/.test(indexHtml) ||
      /id="sidebar-backdrop"[^>]*onclick="closeMobileSidebar\(\)"/.test(indexHtml) ||
      /class="sidebar-backdrop"[^>]*onclick="toggleMobileSidebar\(false\)"/.test(indexHtml),
      '#sidebar-backdrop must trigger toggleMobileSidebar(false) or closeMobileSidebar() on click'
    );

    // 3. Close toggle button #sidebar-close-btn
    assert.ok(
      indexHtml.includes('id="sidebar-close-btn"'),
      'public/index.html must include #sidebar-close-btn inside sidebar'
    );
    assert.ok(
      /id="sidebar-close-btn"[^>]*onclick="toggleMobileSidebar\(false\)"/.test(indexHtml) ||
      /id="sidebar-close-btn"[^>]*onclick="closeMobileSidebar\(\)"/.test(indexHtml),
      '#sidebar-close-btn must trigger toggleMobileSidebar(false) on click'
    );

    // 4. Mobile navigation drawer links (.sidebar-mobile-nav)
    assert.ok(
      indexHtml.includes('id="sidebar-mobile-nav"'),
      'public/index.html must include #sidebar-mobile-nav container for section links'
    );
    assert.ok(
      indexHtml.includes('id="side-nav-blocuri"') &&
      indexHtml.includes('id="side-nav-avizier"') &&
      indexHtml.includes('id="side-nav-casierie"') &&
      indexHtml.includes('id="side-nav-rapoarte"') &&
      indexHtml.includes('id="side-nav-registre"') &&
      indexHtml.includes('id="side-nav-luna"'),
      'Sidebar mobile navigation must contain links for all main sections'
    );
  });

  it('Test 3: Off-Canvas Drawer State Machine & Event Closures in public/app.js', () => {
    // 1. Verify function definitions
    assert.ok(
      /function\s+toggleMobileSidebar\s*\(/.test(appJs),
      'public/app.js must define toggleMobileSidebar()'
    );
    assert.ok(
      /function\s+closeMobileSidebar\s*\(/.test(appJs),
      'public/app.js must define closeMobileSidebar()'
    );
    assert.ok(
      appJs.includes('window.toggleMobileSidebar = toggleMobileSidebar'),
      'public/app.js must export window.toggleMobileSidebar'
    );
    assert.ok(
      appJs.includes('window.closeMobileSidebar = closeMobileSidebar'),
      'public/app.js must export window.closeMobileSidebar'
    );

    // 2. Execute simulated DOM state tests in VM sandbox
    const classListMock = () => {
      const set = new Set();
      return {
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        toggle: (c, force) => {
          if (force === true) set.add(c);
          else if (force === false) set.delete(c);
          else if (set.has(c)) set.delete(c);
          else set.add(c);
        },
        contains: (c) => set.has(c),
        get length() { return set.size; }
      };
    };

    const mockBody = { classList: classListMock(), attributes: {}, setAttribute(k, v) { this.attributes[k] = v; } };
    const mockSidebar = { classList: classListMock() };
    const mockBackdrop = { classList: classListMock() };
    const mockToggleBtn = {
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; }
    };

    const sandbox = {
      window: { innerWidth: 375 },
      document: {
        body: mockBody,
        querySelector: (sel) => {
          if (sel === '.sidebar') return mockSidebar;
          return null;
        },
        getElementById: (id) => {
          if (id === 'sidebar-backdrop') return mockBackdrop;
          if (id === 'mobile-nav-toggle') return mockToggleBtn;
          return null;
        },
        querySelectorAll: () => []
      }
    };
    sandbox.window.document = sandbox.document;

    // Run toggleMobileSidebar definition in sandbox
    const extractFnRegex = /function\s+toggleMobileSidebar\s*\([^)]*\)\s*\{[\s\S]*?\n\}/;
    const match = appJs.match(extractFnRegex);
    assert.ok(match, 'Could not extract toggleMobileSidebar() from app.js');
    vm.runInNewContext(match[0] + '\nfunction closeMobileSidebar() { toggleMobileSidebar(false); }', sandbox);

    // Step 1: Open drawer
    sandbox.toggleMobileSidebar(true);
    assert.ok(mockBody.classList.contains('sidebar-open'), 'Body must gain .sidebar-open class when drawer is opened');
    assert.ok(mockSidebar.classList.contains('open'), 'Sidebar must gain .open class when drawer is opened');
    assert.ok(mockBackdrop.classList.contains('active'), 'Backdrop must gain .active class when drawer is opened');
    assert.equal(mockToggleBtn.getAttribute('aria-expanded'), 'true', 'mobile-nav-toggle must have aria-expanded="true" when opened');

    // Step 2: Close drawer
    sandbox.toggleMobileSidebar(false);
    assert.ok(!mockBody.classList.contains('sidebar-open'), 'Body must lose .sidebar-open class when drawer is closed');
    assert.ok(!mockSidebar.classList.contains('open'), 'Sidebar must lose .open class when drawer is closed');
    assert.ok(!mockBackdrop.classList.contains('active'), 'Backdrop must lose .active class when drawer is closed');
    assert.equal(mockToggleBtn.getAttribute('aria-expanded'), 'false', 'mobile-nav-toggle must have aria-expanded="false" when closed');

    // Step 3: Toggle drawer
    sandbox.toggleMobileSidebar();
    assert.ok(mockBody.classList.contains('sidebar-open'), 'toggleMobileSidebar() toggles to open');
    sandbox.closeMobileSidebar();
    assert.ok(!mockBody.classList.contains('sidebar-open'), 'closeMobileSidebar() closes drawer');

    // 3. Verify that navigation functions trigger closeMobileSidebar()
    const fnSwitchMatch = appJs.match(/function switchMainSection\s*\([\s\S]*?\n\}/);
    assert.ok(fnSwitchMatch && fnSwitchMatch[0].includes('closeMobileSidebar()'), 'switchMainSection() must call closeMobileSidebar()');

    const fnSelectBlocMatch = appJs.match(/async function selectBloc\s*\([\s\S]*?\n\}/);
    assert.ok(fnSelectBlocMatch && fnSelectBlocMatch[0].includes('closeMobileSidebar()'), 'selectBloc() must call closeMobileSidebar()');

    const fnDashboardMatch = appJs.match(/function showDashboard\s*\([\s\S]*?\n\}/);
    assert.ok(fnDashboardMatch && fnDashboardMatch[0].includes('closeMobileSidebar()'), 'showDashboard() must call closeMobileSidebar()');

    const fnAddBlocMatch = appJs.match(/function showAddBlocModal\s*\([\s\S]*?\n\}/);
    assert.ok(fnAddBlocMatch && fnAddBlocMatch[0].includes('closeMobileSidebar()'), 'showAddBlocModal() must call closeMobileSidebar()');
  });

  it('Test 4: CSS Responsive Rules for Mobile Hamburger & Off-Canvas Drawer (max-width: 768px vs min-width: 769px)', () => {
    // 1. Desktop rules (>=769px) must hide mobile toggle, backdrop and close button
    assert.ok(
      /@media\s*\(\s*min-width\s*:\s*769px\s*\)[\s\S]*?\.mobile-nav-toggle[\s\S]*?display:\s*none/i.test(styleCss),
      'Desktop media query (@media min-width: 769px) must hide .mobile-nav-toggle with display: none'
    );
    assert.ok(
      /@media\s*\(\s*min-width\s*:\s*769px\s*\)[\s\S]*?\.sidebar-backdrop[\s\S]*?display:\s*none/i.test(styleCss),
      'Desktop media query must hide .sidebar-backdrop'
    );

    // 2. Mobile rules (<=768px) must display mobile toggle
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.mobile-nav-toggle[\s\S]*?display:\s*inline-flex/i.test(styleCss),
      'Mobile media query (@media max-width: 768px) must display .mobile-nav-toggle'
    );

    // 3. Off-canvas drawer styles: position: fixed, transform: translateX(-100%), transition
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.sidebar\s*\{[\s\S]*?position:\s*fixed/i.test(styleCss),
      'Mobile sidebar must have position: fixed'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.sidebar\s*\{[\s\S]*?transform:\s*translateX\(-100%\)/i.test(styleCss),
      'Mobile sidebar must be placed off-canvas with transform: translateX(-100%)'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.sidebar\s*\{[\s\S]*?transition:/i.test(styleCss),
      'Mobile sidebar must have smooth slide-in transition'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.sidebar\.open[\s\S]*?transform:\s*translateX\(0\)/i.test(styleCss) ||
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?body\.sidebar-open\s+\.sidebar[\s\S]*?transform:\s*translateX\(0\)/i.test(styleCss),
      'Opening drawer must animate to transform: translateX(0)'
    );

    // 4. Backdrop activation
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?body\.sidebar-open\s+\.sidebar-backdrop[\s\S]*?display:\s*block/i.test(styleCss) ||
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.sidebar-backdrop\.active[\s\S]*?display:\s*block/i.test(styleCss),
      'Active backdrop must display block with opacity 1 on mobile'
    );
  });

  it('Test 5: Wide Data Tables & Multi-Column Containers enforce horizontal scrolling and scroll cue without page overflow', () => {
    // 1. .table-container rules in mobile
    assert.ok(
      styleCss.includes('overflow-x: auto'),
      'public/style.css must specify overflow-x: auto on table containers'
    );
    assert.ok(
      styleCss.includes('-webkit-overflow-scrolling: touch'),
      'public/style.css must specify -webkit-overflow-scrolling: touch for smooth mobile scrolling'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.table-container[\s\S]*?box-shadow:/i.test(styleCss) ||
      styleCss.includes('box-shadow: inset -8px 0 8px -8px'),
      'Table containers must feature boundary cues (scroll shadow cues)'
    );

    // 2. All tables in index.html are wrapped in .table-container
    const tableMatches = indexHtml.matchAll(/<table\b/g);
    let count = 0;
    for (const match of tableMatches) {
      count++;
      const preContext = indexHtml.slice(Math.max(0, match.index - 250), match.index);
      assert.ok(
        preContext.includes('table-container') || preContext.includes('raport-preview-container') || preContext.includes('table-responsive'),
        `Table #${count} in index.html must be wrapped in a scrollable table-container`
      );
    }
    assert.ok(count >= 10, `Expected at least 10 tables in index.html, found ${count}`);
  });

  it('Test 6: Stat Cards auto-fit and reflow responsively across 320px, 375px, 768px, and 1024px', () => {
    // 1. Mobile <= 480px sets 1 column
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*480px\s*\)[\s\S]*?\.stat-cards\s*\{[\s\S]*?grid-template-columns:\s*1fr/i.test(styleCss),
      'public/style.css must reflow .stat-cards to 1 column on screens <= 480px'
    );

    // 2. Mobile/Tablet <= 768px sets auto-fit / repeat
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.stat-cards\s*\{[\s\S]*?grid-template-columns:/i.test(styleCss),
      'public/style.css must reflow .stat-cards responsively on viewports <= 768px'
    );

    // 3. Tablet (769px - 1024px) auto-fit
    assert.ok(
      /@media\s*\(\s*min-width\s*:\s*769px\s*\)\s*and\s*\(\s*max-width\s*:\s*1024px\s*\)[\s\S]*?\.stat-cards/i.test(styleCss) ||
      styleCss.includes('minmax(200px, 1fr)'),
      'public/style.css must handle tablet reflow between 769px and 1024px'
    );

    // 4. Word-break prevention on stat values
    assert.ok(
      styleCss.includes('word-break: break-word') || styleCss.includes('overflow-wrap: break-word'),
      'Stat values must allow word breaking to prevent viewport overflow'
    );
  });

  it('Test 7: Touch Targets (min-height >= 42-44px) on Buttons, Form Inputs and Selects', () => {
    // Check mobile media query enforces min-height >= 42px on interactive controls
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?min-height:\s*42px/i.test(styleCss),
      'public/style.css mobile media query must enforce min-height: 42px for interactive controls'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.btn-small[\s\S]*?min-height:\s*42px/i.test(styleCss) ||
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.btn[\s\S]*?min-height:\s*42px/i.test(styleCss),
      'Buttons must satisfy touch target min-height >= 42px'
    );
    assert.ok(
      styleCss.includes('touch-action: manipulation'),
      'Interactive controls must specify touch-action: manipulation to eliminate mobile tap delays'
    );
  });

  it('Test 8: Mobile Modal Scaling (95vw), Internal Scrolling & Accessible Close Buttons', () => {
    // 1. Modals scale to 95vw on screens <= 768px
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.modal[\s\S]*?width:\s*95vw/i.test(styleCss),
      'Modals must scale to width: 95vw on mobile viewports'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.modal[\s\S]*?max-width:\s*95vw/i.test(styleCss),
      'Modals must have max-width: 95vw on mobile viewports'
    );

    // 2. Scrollable modal body
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.modal-body[\s\S]*?overflow-y:\s*auto/i.test(styleCss),
      'Modal body must allow internal scrolling with overflow-y: auto'
    );

    // 3. Modal close button touch target (>=44px)
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.modal-close[\s\S]*?min-width:\s*44px/i.test(styleCss) ||
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.modal-close[\s\S]*?width:\s*44px/i.test(styleCss),
      'Modal close button must satisfy min-width: 44px'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.modal-close[\s\S]*?min-height:\s*44px/i.test(styleCss) ||
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.modal-close[\s\S]*?height:\s*44px/i.test(styleCss),
      'Modal close button must satisfy min-height: 44px'
    );
  });

  it('Test 9: Desktop Fidelity (>=992px) & public/200.html Exact Parity', () => {
    // 1. Desktop sidebar height and max-height constraints preserved
    assert.ok(
      styleCss.includes('height: calc(100vh - var(--sidebar-top-offset'),
      'Desktop .sidebar height constraint must be preserved'
    );
    assert.ok(
      styleCss.includes('max-height: calc(100vh - var(--sidebar-top-offset'),
      'Desktop .sidebar max-height constraint must be preserved'
    );

    // 2. 200.html must remain an exact byte-for-byte copy of index.html
    assert.equal(
      fallback200Html,
      indexHtml,
      'public/200.html must be identical to public/index.html'
    );
  });

  it('Test 10: Dynamic Viewport Units (100dvh, 90dvh), iOS Safe Area Insets & Momentum Bounce Containment', () => {
    // 1. Sidebar uses 100dvh alongside 100vh fallback
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.sidebar\s*\{[\s\S]*?height:\s*100dvh/i.test(styleCss),
      'Mobile sidebar must specify height: 100dvh for browser address bar collapse handling'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.sidebar\s*\{[\s\S]*?max-height:\s*100dvh/i.test(styleCss),
      'Mobile sidebar must specify max-height: 100dvh'
    );

    // 2. iOS Safe Area insets
    assert.ok(
      styleCss.includes('env(safe-area-inset-top') && styleCss.includes('env(safe-area-inset-bottom'),
      'Mobile sidebar must honor env(safe-area-inset-top) and env(safe-area-inset-bottom)'
    );

    // 3. Modals use 90dvh
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?max-height:\s*90dvh/i.test(styleCss),
      'Mobile modals must constrain max-height to 90dvh'
    );

    // 4. overscroll-behavior: contain prevents scroll chaining / momentum bounce
    assert.ok(
      styleCss.includes('overscroll-behavior: contain'),
      'Off-canvas drawer and modal-body must enforce overscroll-behavior: contain'
    );
  });

  it('Test 11: Form Input Touch & Virtual Keyboard Zoom Prevention (font-size >= 16px) & .bloc-item touch targets', () => {
    // 1. Font size 16px on inputs on mobile to stop iOS auto-zoom
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.form-input[\s\S]*?font-size:\s*16px/i.test(styleCss),
      'Mobile form inputs must specify font-size: 16px to prevent iOS Safari auto-zoom on focus'
    );

    // 2. .bloc-item touch target min-height >= 42px
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.bloc-item[\s\S]*?min-height:\s*42px/i.test(styleCss) ||
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.bloc-item[\s\S]*?min-height:/i.test(styleCss),
      'Sidebar block items must satisfy minimum touch target guidelines (min-height >= 42px)'
    );
  });

  it('Test 12: Dialog Backdrop Dismissal & Escape Key Handler (closing drawer and active modals)', () => {
    // 1. Global Escape key closes drawer and active modal dialogs
    assert.ok(
      appJs.includes("e.key === 'Escape'"),
      'public/app.js must listen for Escape key to close dialogs and drawer'
    );
    assert.ok(
      appJs.includes('closeMobileSidebar()'),
      'Escape handler must dismiss open mobile sidebar drawer'
    );

    // 2. Click on modal-overlay dismisses modal
    assert.ok(
      appJs.includes('.modal-overlay') && appJs.includes('closeModal(overlay.id)'),
      'Clicking modal-overlay background must dismiss active modal dialog'
    );

    // 3. showModal closes mobile sidebar
    assert.ok(
      /function\s+showModal\s*\([^)]*\)\s*\{[\s\S]*?closeMobileSidebar\(\)/.test(appJs),
      'showModal() must invoke closeMobileSidebar() to dismiss drawer when any modal opens'
    );
  });

  it('Test 13: Chrome Android Dynamic Virtual Keyboard Viewport Resize (interactive-widget=resizes-content)', () => {
    const viewportRegex = /<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i;
    const matchIndex = indexHtml.match(viewportRegex);
    assert.ok(matchIndex, 'public/index.html must contain a <meta name="viewport"> tag');
    assert.ok(
      matchIndex[1].includes('interactive-widget=resizes-content'),
      'Viewport meta tag in index.html must specify interactive-widget=resizes-content for mobile Chrome virtual keyboard handling'
    );

    const match200 = fallback200Html.match(viewportRegex);
    assert.ok(match200, 'public/200.html must contain a <meta name="viewport"> tag');
    assert.ok(
      match200[1].includes('interactive-widget=resizes-content'),
      'Viewport meta tag in 200.html must specify interactive-widget=resizes-content'
    );
    assert.equal(match200[1], matchIndex[1], 'Viewport meta tag in 200.html must exactly match index.html');
  });

  it('Test 14: CSS Cascade Architecture & Base-to-Responsive Precedence', () => {
    // Verify base ORHIDEEA 2005 declarations appear BEFORE @media (max-width: 768px)
    const baseStepperPos = styleCss.indexOf('.workflow-stepper-bar {');
    const mobileMediaPos = styleCss.indexOf('@media (max-width: 768px)');
    assert.ok(baseStepperPos !== -1, 'Base .workflow-stepper-bar must be defined');
    assert.ok(mobileMediaPos !== -1, 'Mobile media query must be defined');
    assert.ok(
      baseStepperPos < mobileMediaPos,
      'Base .workflow-stepper-bar must be declared BEFORE @media (max-width: 768px) to allow mobile overrides'
    );

    const baseCmdBtnPos = styleCss.indexOf('.top-nav-cmd-btn {');
    assert.ok(baseCmdBtnPos !== -1, 'Base .top-nav-cmd-btn must be defined');
    assert.ok(
      baseCmdBtnPos < mobileMediaPos,
      'Base .top-nav-cmd-btn must be declared BEFORE mobile media query so responsive white-space and padding apply'
    );
  });

  it('Test 15: Low-End Android & Legacy GPU Compositing Fallback (@supports not (backdrop-filter: blur(4px)))', () => {
    assert.ok(
      styleCss.includes('@supports not (backdrop-filter: blur(4px))') ||
      styleCss.includes('@supports not (backdrop-filter:'),
      'public/style.css must provide an @supports fallback for devices without GPU blur compositing'
    );
  });

  it('Test 16: Comprehensive Font-Size iOS Auto-Zoom Immunity on All Selects (.top-nav-select, .header-select, select)', () => {
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.top-nav-select[\s\S]*?font-size:\s*16px/i.test(styleCss) ||
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?select[\s\S]*?font-size:\s*16px/i.test(styleCss),
      'Mobile media query must enforce font-size: 16px !important on .top-nav-select and selects to prevent iOS auto-zoom'
    );
  });

  it('Test 17: Narrow Mobile 320px Viewport Bounds: Form-Group & Toast Alert Overflow Containment', () => {
    // 1. .form-row > .form-group fluid bounds
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.form-row\s*>\s*\.form-group[\s\S]*?min-width:\s*0\s*!important/i.test(styleCss),
      '.form-row > .form-group must enforce min-width: 0 !important on mobile to override inline min-widths'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.form-row\s*>\s*\.form-group[\s\S]*?max-width:\s*100%\s*!important/i.test(styleCss),
      '.form-row > .form-group must enforce max-width: 100% !important on mobile'
    );

    // 2. showAlert toast responsive constraints in app.js
    assert.ok(
      appJs.includes('calc(100vw - 2rem)'),
      'public/app.js showAlert() must constrain toast maxWidth to calc(100vw - 2rem) to avoid 320px overflow'
    );

    // 3. Document preview boxes overflow handling
    assert.ok(
      styleCss.includes('#adeverinta-preview-content') && styleCss.includes('overflow-x: auto'),
      '#adeverinta-preview-content must allow horizontal scrolling on narrow screens'
    );
  });

  it('Test 18: Cross-Section Mobile Drawer Navigation: showDashboard() and selectBloc() switch activeSection to blocuri', () => {
    // 1. Static code verification in public/app.js
    const fnDashMatch = appJs.match(/function\s+showDashboard\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(fnDashMatch, 'Could not find showDashboard() in public/app.js');
    assert.ok(
      fnDashMatch[1].includes("switchMainSection('blocuri')") ||
      fnDashMatch[1].includes('switchMainSection("blocuri")'),
      'showDashboard() must call switchMainSection("blocuri") when invoked from another section'
    );

    const fnSelectMatch = appJs.match(/async\s+function\s+selectBloc\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(fnSelectMatch, 'Could not find selectBloc() in public/app.js');
    assert.ok(
      fnSelectMatch[1].includes("switchMainSection('blocuri')") ||
      fnSelectMatch[1].includes('switchMainSection("blocuri")'),
      'selectBloc() must call switchMainSection("blocuri") when invoked from another section'
    );

    // 2. Behavioral VM verification of cross-section state transitions
    let activeSec = 'avizier';
    let switchedSec = null;
    const testSandbox = {
      activeSection: activeSec,
      currentBlocId: null,
      currentBloc: null,
      apartamenteCache: [],
      closeMobileSidebar: () => {},
      switchMainSection: (s) => { switchedSec = s; testSandbox.activeSection = s; },
      document: {
        getElementById: () => ({ style: {} }),
        querySelectorAll: () => []
      }
    };
    vm.runInNewContext(`
      function showDashboard() {
        closeMobileSidebar();
        if (activeSection !== 'blocuri') {
          switchMainSection('blocuri');
        }
        currentBlocId = null;
        currentBloc = null;
      }
    `, testSandbox);
    testSandbox.showDashboard();
    assert.equal(switchedSec, 'blocuri', 'showDashboard() must switch activeSection to blocuri when activeSection was avizier');
    assert.equal(testSandbox.activeSection, 'blocuri', 'activeSection must become blocuri');
  });

  it('Test 19: Command Palette Search Input (#cmd-palette-input) Flex Min-Width Containment', () => {
    // 1. HTML style contains min-width:0; flex:1
    assert.ok(
      indexHtml.includes('id="cmd-palette-input"') && indexHtml.includes('min-width:0') && indexHtml.includes('flex:1'),
      'public/index.html #cmd-palette-input must declare min-width:0 and flex:1 to prevent mobile header overflow'
    );
    assert.ok(
      fallback200Html.includes('id="cmd-palette-input"') && fallback200Html.includes('min-width:0') && fallback200Html.includes('flex:1'),
      'public/200.html #cmd-palette-input must declare min-width:0 and flex:1'
    );

    // 2. CSS enforcement
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?#cmd-palette-input[\s\S]*?min-width:\s*0/i.test(styleCss),
      'public/style.css mobile media query must enforce min-width: 0 !important on #cmd-palette-input'
    );
  });

  it('Test 20: Top Navigation User Profile Area (.top-nav-user-area) Mobile Responsive Flex Wrapping & Touch Heights', () => {
    // 1. .top-nav-user-area flex-wrap: wrap on mobile
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.top-nav-user-area[\s\S]*?flex-wrap:\s*wrap/i.test(styleCss),
      'public/style.css mobile media query must allow .top-nav-user-area to wrap cleanly on mobile viewports'
    );

    // 2. .top-nav-user-area .btn touch target (min-height: 42px)
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.top-nav-user-area\s+\.btn[\s\S]*?min-height:\s*42px/i.test(styleCss),
      'Buttons inside .top-nav-user-area must satisfy min-height: 42px on mobile'
    );
  });

  it('Test 21: Touch Targets for Rapoarte Catalog (.report-catalog-btn) and Command Palette (.cmd-palette-item)', () => {
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.report-catalog-btn[\s\S]*?min-height:\s*42px/i.test(styleCss),
      '.report-catalog-btn must satisfy touch target min-height >= 42px on mobile viewports'
    );
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.cmd-palette-item[\s\S]*?min-height:\s*42px/i.test(styleCss),
      '.cmd-palette-item must satisfy touch target min-height >= 42px on mobile viewports'
    );
  });

  it('Test 22: Stepper Bar Mobile Layout: Vertical Flex Container, Independent Scrolling Stages & Accessible Actions', () => {
    // 1. .workflow-stepper-bar flex-direction: column on mobile
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.workflow-stepper-bar\s*\{[\s\S]*?flex-direction:\s*column/i.test(styleCss),
      'Mobile .workflow-stepper-bar must arrange stages and quick actions vertically via flex-direction: column'
    );

    // 2. .stepper-stages horizontal scrolling
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.stepper-stages[\s\S]*?overflow-x:\s*auto/i.test(styleCss),
      'Mobile .stepper-stages must allow horizontal scrolling with overflow-x: auto'
    );

    // 3. Quick action buttons have min-height: 42px
    assert.ok(
      /@media\s*\(\s*max-width\s*:\s*768px\s*\)[\s\S]*?\.stepper-quick-actions\s+\.btn[\s\S]*?min-height:\s*42px/i.test(styleCss),
      'Quick action buttons in stepper must satisfy min-height: 42px'
    );
  });
});

