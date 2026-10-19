/**
 * tests/e2e/all_buttons_and_sidebar_audit.test.js
 *
 * Automated Button, Modal, DOM ID & 15.6-inch Laptop Sidebar Audit Suite:
 *  1. Zero SyntaxErrors & No Duplicate let/const declarations in public/app.js and public/browser-runtime.js
 *  2. 100% Event Handler Verification across public/index.html and public/app.js
 *  3. Critical Modal & Section DOM ID Parity (ADG, ADA, Apartament Extins, Rapoarte, Registre, Control Tower, ADE)
 *  4. 15.6-inch Laptop Sidebar & "+ Adaugă Bloc" Visibility + public/200.html Parity
 *  5. Exact DOM ID binding verification in addActPatrimoniu() and createNewCleanAsociatie()
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

describe('Automated Button, Modal & Sidebar Audit Suite', () => {
  it('Test 1: Zero SyntaxErrors & No Duplicate let/const in public/app.js and public/browser-runtime.js', () => {
    assert.doesNotThrow(() => {
      new vm.Script(browserRuntimeJs, { filename: 'browser-runtime.js' });
    }, 'public/browser-runtime.js must compile with zero SyntaxErrors');

    assert.doesNotThrow(() => {
      new vm.Script(appJs, { filename: 'app.js' });
    }, 'public/app.js must compile with zero SyntaxErrors (no duplicate let/const)');

    assert.doesNotThrow(() => {
      new vm.Script(browserRuntimeJs + '\n;\n' + appJs, { filename: 'combined-browser-scripts.js' });
    }, 'Combined browser-runtime.js + app.js must compile in shared global scope without duplicate top-level declarations');
  });

  it('Test 2: 100% Event Handler Verification in public/index.html & public/app.js', () => {
    const combinedJs = browserRuntimeJs + '\n' + appJs;
    const eventAttrRegex = /\b(?:onclick|onchange|oninput|onkeydown|onsubmit)\s*=\s*"([^"]+)"/g;
    const handlersFound = [];

    let match;
    while ((match = eventAttrRegex.exec(indexHtml)) !== null) {
      const expr = match[1].trim();
      // Strip optional inline guard `if(event.target===this) `
      const cleaned = expr.replace(/^if\s*\([^)]*\)\s*/, '').trim();
      const fnMatch = cleaned.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
      assert.ok(fnMatch, `Could not parse function call from event attribute: ${expr}`);
      handlersFound.push({ attr: expr, fnName: fnMatch[1] });
    }

    assert.ok(handlersFound.length >= 60, `Expected at least 60 event attributes in index.html, found ${handlersFound.length}`);

    for (const { attr, fnName } of handlersFound) {
      const patterns = [
        new RegExp(`\\bfunction\\s+${fnName}\\s*\\(`),
        new RegExp(`\\b(?:const|let|var)\\s+${fnName}\\s*=`),
        new RegExp(`\\bwindow\\.${fnName}\\s*=`)
      ];
      const isDefined = patterns.some(re => re.test(combinedJs));
      assert.ok(
        isDefined,
        `Event handler function "${fnName}" (from "${attr}" in index.html) is NOT defined in public/app.js or public/browser-runtime.js`
      );
    }
  });

  it('Test 3: Critical Modal & Section DOM ID Parity between public/index.html and public/app.js', () => {
    const idGroups = {
      'ADG Modal': [
        'adg-an', 'adg-luna', 'adg-ultima-zi', 'adg-tarif-ar',
        'adg-tarif-ca', 'adg-proc-ca', 'adg-tarif-et', 'adg-status'
      ],
      'ADA Modal': [
        'ada-apa-rece', 'ada-can-met', 'ada-apa-calda', 'ada-etac',
        'ada-incalzire', 'ada-gunoi', 'ada-ch-admin', 'ada-sal-tesa',
        'ada-sal-feme', 'ada-abonament', 'ada-ch-sediu', 'ada-rulment', 'ada-cota-fr'
      ],
      'Apartament Extins Modal': [
        'ext-ap-id', 'ext-ap-title', 'tbody-modal-r1-r7',
        'ext-ser-ar-bu', 'ext-dv-ar-bu', 'ext-max-fr', 'ext-fond-repar'
      ],
      'Rapoarte Catalog & Header': [
        'catalog-listare-items', 'catalog-situatii-items', 'catalog-centralizare-items',
        'raport-active-code', 'raport-active-title', 'raport-active-meta', 'raport-orientation-badge'
      ],
      'Registre & Raw DB': [
        'patr-doc', 'patr-suma', 'raw-table-select', 'thead-reg-raw', 'tbody-reg-raw'
      ],
      'Control Tower New Asoc': [
        'new-asoc-nume', 'new-asoc-cui', 'new-asoc-admin', 'new-asoc-pres'
      ],
      'Adeverință Notar (ADE)': [
        'modal-adeverinta', 'ade-nr-inr', 'ade-data-inr', 'ade-serv', 'adeverinta-preview-content'
      ]
    };

    for (const [groupName, ids] of Object.entries(idGroups)) {
      for (const id of ids) {
        const idPattern = new RegExp(`\\bid\\s*=\\s*["']${id}["']`);
        assert.ok(
          idPattern.test(indexHtml),
          `[${groupName}] Required DOM ID "#${id}" is missing from public/index.html`
        );
        assert.ok(
          appJs.includes(id),
          `[${groupName}] Required DOM ID "#${id}" is not referenced in public/app.js`
        );
      }
    }
  });

  it('Test 4: 15.6-inch Laptop Sidebar & "+ Adaugă Bloc" Visibility + 200.html Parity', () => {
    // 1. CSS constraints on .sidebar
    assert.ok(
      styleCss.includes('height: calc(100vh - var(--sidebar-top-offset'),
      'public/style.css must constrain .sidebar height with calc(100vh - var(--sidebar-top-offset...))'
    );
    assert.ok(
      styleCss.includes('max-height: calc(100vh - var(--sidebar-top-offset'),
      'public/style.css must constrain .sidebar max-height with calc(100vh - var(--sidebar-top-offset...))'
    );

    // 2. JS defines and calls syncSidebarViewportHeight
    assert.ok(
      /function\s+syncSidebarViewportHeight\s*\(/.test(appJs),
      'public/app.js must define syncSidebarViewportHeight()'
    );
    const callMatches = appJs.match(/\bsyncSidebarViewportHeight\s*\(/g) || [];
    assert.ok(
      callMatches.length >= 3,
      `public/app.js must define and invoke syncSidebarViewportHeight() on init/navigation (found ${callMatches.length} occurrences)`
    );

    // 3. Sidebar header and footer both have showAddBlocModal()
    const sidebarHeaderMatch = indexHtml.match(/<div class="sidebar-header">([\s\S]*?)<\/div>\s*<div class="bloc-list"/);
    assert.ok(sidebarHeaderMatch, 'Could not locate .sidebar-header in public/index.html');
    assert.ok(
      sidebarHeaderMatch[1].includes('showAddBlocModal()'),
      '.sidebar-header must contain a "+ Adaugă Bloc" button calling showAddBlocModal()'
    );

    const sidebarFooterMatch = indexHtml.match(/<div class="sidebar-footer">([\s\S]*?)<\/div>\s*<\/aside>/);
    assert.ok(sidebarFooterMatch, 'Could not locate .sidebar-footer in public/index.html');
    assert.ok(
      sidebarFooterMatch[1].includes('id="btn-sidebar-add-bloc"') &&
      sidebarFooterMatch[1].includes('showAddBlocModal()'),
      '.sidebar-footer must contain #btn-sidebar-add-bloc calling showAddBlocModal()'
    );

    // 4. public/200.html is identical to public/index.html
    assert.equal(
      fallback200Html,
      indexHtml,
      'public/200.html must be an exact copy of public/index.html'
    );
  });

  it('Test 5: Check addActPatrimoniu() and createNewCleanAsociatie() DOM IDs', () => {
    const fnAddPatrMatch = appJs.match(/async function addActPatrimoniu\s*\(\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(fnAddPatrMatch, 'addActPatrimoniu() must exist in public/app.js');
    const fnAddPatrBody = fnAddPatrMatch[1];

    const requiredPatrIds = [
      'patr-doc',
      'patr-data',
      'patr-act-pas',
      'patr-suma',
      'patr-explicatie',
      'patr-perioada',
      'patr-data-pres'
    ];
    for (const id of requiredPatrIds) {
      assert.ok(
        indexHtml.includes(`id="${id}"`),
        `public/index.html must contain id="${id}" for Patrimoniu form`
      );
      assert.ok(
        fnAddPatrBody.includes(`'${id}'`) || fnAddPatrBody.includes(`"${id}"`),
        `addActPatrimoniu() in public/app.js must reference exact DOM ID "${id}"`
      );
    }

    const fnCreateAsocMatch = appJs.match(/async function createNewCleanAsociatie\s*\(\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(fnCreateAsocMatch, 'createNewCleanAsociatie() must exist in public/app.js');
    const fnCreateAsocBody = fnCreateAsocMatch[1];

    const requiredNewAsocIds = [
      'new-asoc-nume',
      'new-asoc-cui',
      'new-asoc-admin',
      'new-asoc-pres',
      'new-asoc-adresa',
      'new-asoc-serie',
      'new-asoc-luna',
      'new-asoc-an'
    ];
    for (const id of requiredNewAsocIds) {
      assert.ok(
        indexHtml.includes(`id="${id}"`),
        `public/index.html must contain id="${id}" for New Asociatie form`
      );
      assert.ok(
        fnCreateAsocBody.includes(`'${id}'`) || fnCreateAsocBody.includes(`"${id}"`),
        `createNewCleanAsociatie() in public/app.js must reference exact DOM ID "${id}"`
      );
    }
  });

  it('Test 6: Dynamic Event Handlers in public/app.js & Setari Bloc (ADB/ADR) DOM ID Parity', () => {
    const combinedJs = browserRuntimeJs + '\n' + appJs;
    const dynEventRegex = /\b(?:onclick|onchange|oninput)\s*=\s*["']([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match;
    const dynFns = new Set();
    while ((match = dynEventRegex.exec(appJs)) !== null) {
      dynFns.add(match[1]);
    }
    assert.ok(dynFns.size >= 10, `Expected at least 10 dynamic event handlers in app.js, found ${dynFns.size}`);
    for (const fnName of dynFns) {
      const patterns = [
        new RegExp(`\\bfunction\\s+${fnName}\\s*\\(`),
        new RegExp(`\\b(?:const|let|var)\\s+${fnName}\\s*=`),
        new RegExp(`\\bwindow\\.${fnName}\\s*=`)
      ];
      assert.ok(
        patterns.some(re => re.test(combinedJs)),
        `Dynamic event handler "${fnName}" in app.js template is not defined`
      );
    }

    const setariBlocIds = [
      'set-bloc', 'set-strada', 'set-numar', 'set-cod-postal',
      'set-tarif-ar', 'set-tarif-canal', 'set-tarif-ac', 'set-tarif-et',
      'set-ecart-temp', 'set-rand-tr', 'set-constin', 'set-procinccom',
      'set-cp-ar', 'set-cp-ac', 'set-cp-in',
      'set-mod-r-dif', 'set-mod-r-inc', 'set-modr-difin', 'set-mod-r-asc',
      'set-fact-gaz', 'set-fact-gunoi', 'set-fact-curent-sc', 'set-fact-curent-li',
      'set-fact-ascensor', 'set-fact-sal-feme', 'set-fact-sal-tesa', 'set-fact-ch-admin',
      'set-fact-ch-sediu', 'set-fact-prest-serv', 'set-fact-chelt-inc', 'set-fact-can-met',
      'set-proc-sal-f', 'set-proc-sal-t', 'set-proc-gunoi', 'set-cota-fr'
    ];
    for (const id of setariBlocIds) {
      assert.ok(indexHtml.includes(`id="${id}"`), `Setari Bloc ID "#${id}" missing from index.html`);
      assert.ok(appJs.includes(id), `Setari Bloc ID "#${id}" not referenced in app.js`);
    }
  });
});
