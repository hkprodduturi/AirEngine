/**
 * Core JSX generator — recursive walker that turns AIR UI nodes into JSX strings.
 */

import type { AirUINode } from '../../parser/types.js';
import type { TranspileContext } from '../context.js';
import type { UIAnalysis, ResolvedBind } from '../normalize-ui.js';
import { resolveBindChain } from '../normalize-ui.js';
import { mapElement } from '../element-map.js';
import {
  Scope, ROOT_SCOPE, ICON_EMOJI,
  capitalize, escapeText, escapeAttr, interpolateText, deriveLabel, classAttr,
  findStateField, resolveSetterFromRef, nodeToString, deriveEmptyLabel,
  inferModelFieldsFromDataSource,
  setter, wrapFormGroup,
  resolveRef, resolveRefNode, resolveDotExpr, resolvePipeExpr, resolvePipeExprSimple,
  resolvePipeSource, extractDataSource,
  extractActionName, extractActionArgs,
  ResolvedElement, tryResolveElement,
  getButtonLabel, extractBaseArrayName,
  findEnumValues, resolveDeepType, findEnumByName,
  analyzePageDependencies, getHookableStateProps,
  findFirstFormAction,
  isAuthPageName, hasAuthRoutes,
} from './helpers.js';

// Module-level flag set during generateRootJSX — avoids threading through entire recursive tree
let _hasAuthGating = false;

// ---- Root JSX ----

export function generateRootJSX(ctx: TranspileContext, analysis: UIAnalysis, useLazy = false, hasAuthGating = false, hasLayout = false): string[] {
  _hasAuthGating = hasAuthGating;
  const rootClasses = 'min-h-screen bg-[var(--bg)] text-[var(--fg)]';

  const maxWidth = ctx.style.maxWidth;

  // Check for sidebar + main layout
  const hasSidebar = ctx.uiNodes.some(n =>
    n.kind === 'element' && n.element === 'sidebar'
  );

  // When Layout is generated for non-auth apps, use it instead of inline sidebar
  if (hasLayout && !hasAuthGating && ctx.hasBackend && analysis.hasPages) {
    const lines: string[] = [];
    // Only pass user/logout to Layout if the app actually has user state (auth mutations)
    const hasUserState = ctx.state.some(f => f.name === 'user');
    const hasLogout = analysis.mutations.some(m => m.name === 'logout');
    const layoutProps = (hasUserState && hasLogout)
      ? 'currentPage={currentPage} setCurrentPage={setCurrentPage} user={user} logout={logout}'
      : 'currentPage={currentPage} setCurrentPage={setCurrentPage}';
    lines.push(`<div className="${rootClasses}">`);
    lines.push(`  <Layout ${layoutProps}>`);

    // Render only page component references (skip sidebar, main, nav nodes)
    // Extract all @page scoped nodes from the UI tree
    const allPages: AirUINode[] = [];
    for (const node of ctx.uiNodes) {
      allPages.push(...extractScopedPages(node));
    }
    const contentIndent = 4;
    if (useLazy) {
      lines.push(`    <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]"></div></div>}>`);
      for (const pn of allPages) {
        const jsx = generateJSX(pn, ctx, analysis, ROOT_SCOPE, contentIndent + 2);
        if (jsx) lines.push(jsx);
      }
      lines.push(`    </Suspense>`);
    } else {
      for (const pn of allPages) {
        const jsx = generateJSX(pn, ctx, analysis, ROOT_SCOPE, contentIndent);
        if (jsx) lines.push(jsx);
      }
    }

    lines.push('  </Layout>');
    lines.push('</div>');
    return lines;
  }

  // Determine wrapper: explicit maxWidth > sidebar (no wrapper) > default 900px container
  // Fullstack pages handle their own padding — don't add px/space-y to wrapper
  const wrapperClass = maxWidth
    ? (analysis.hasPages
      ? `max-w-[${maxWidth}px] mx-auto`
      : `max-w-[${maxWidth}px] mx-auto px-4 sm:px-6 space-y-6`)
    : hasSidebar
      ? ''
      : 'max-w-[900px] mx-auto px-4 sm:px-6 py-8 space-y-6';

  const lines: string[] = [];
  lines.push(`<div className="${rootClasses}">`);

  // When auth-gated, render pages in three tiers:
  // 1. Auth pages (login/register): no guard, no layout
  // 2. Public pages: no auth guard, PublicLayout wrapper
  // 3. Protected pages: isAuthed guard, Layout wrapper (self-contained)
  if (hasAuthGating && hasLayout && analysis.hasPages) {
    const allPages: AirUINode[] = [];
    for (const node of ctx.uiNodes) {
      allPages.push(...extractScopedPages(node));
    }

    const hasPublicPages = ctx.publicPageNames.length > 0;
    const authPages = allPages.filter(p => p.kind === 'scoped' && isAuthPageName(p.name));
    const publicPages = allPages.filter(p => p.kind === 'scoped' && ctx.publicPageNames.includes(p.name));
    const protectedPages = allPages.filter(p =>
      p.kind === 'scoped' && !isAuthPageName(p.name) && !ctx.publicPageNames.includes(p.name)
    );

    const suspenseFallback = '<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]"></div></div>';

    // Auth pages — no guard, no layout
    if (authPages.length > 0) {
      if (useLazy) {
        lines.push(`  <Suspense fallback={${suspenseFallback}}>`);
        for (const pn of authPages) {
          lines.push(generateJSX(pn, ctx, analysis, ROOT_SCOPE, 4));
        }
        lines.push('  </Suspense>');
      } else {
        for (const pn of authPages) {
          lines.push(generateJSX(pn, ctx, analysis, ROOT_SCOPE, 2));
        }
      }
    }

    // Public pages — no auth guard needed, PublicLayout wrapper
    if (publicPages.length > 0) {
      for (const pn of publicPages) {
        if (pn.kind !== 'scoped') continue;
        const pageName = capitalize(pn.name);
        if (useLazy) {
          lines.push(`  {currentPage === '${pn.name}' && (`);
          lines.push(`    <Suspense fallback={${suspenseFallback}}>`);
          lines.push(`      <PublicLayout currentPage={currentPage} setCurrentPage={setCurrentPage}>`);
          lines.push(`        <${pageName}Page currentPage={currentPage} setCurrentPage={setCurrentPage} />`);
          lines.push(`      </PublicLayout>`);
          lines.push(`    </Suspense>`);
          lines.push('  )}');
        } else {
          lines.push(`  {currentPage === '${pn.name}' && (`);
          lines.push(`    <PublicLayout currentPage={currentPage} setCurrentPage={setCurrentPage}>`);
          lines.push(`      <${pageName}Page currentPage={currentPage} setCurrentPage={setCurrentPage} />`);
          lines.push(`    </PublicLayout>`);
          lines.push('  )}');
        }
      }
    }

    // Protected pages — isAuthed guard, self-contained (with Layout inside page component)
    if (protectedPages.length > 0) {
      if (useLazy) {
        lines.push(`  <Suspense fallback={${suspenseFallback}}>`);
        for (const pn of protectedPages) {
          lines.push(generateJSX(pn, ctx, analysis, ROOT_SCOPE, 4));
        }
        lines.push('  </Suspense>');
      } else {
        for (const pn of protectedPages) {
          lines.push(generateJSX(pn, ctx, analysis, ROOT_SCOPE, 2));
        }
      }
    }

    lines.push('</div>');
    return lines;
  }

  if (hasAuthGating && !hasLayout && analysis.hasPages) {
    const allPages: AirUINode[] = [];
    for (const node of ctx.uiNodes) {
      allPages.push(...extractScopedPages(node));
    }
    const authPages = allPages.filter(p => p.kind === 'scoped' && isAuthPageName(p.name));
    const nonAuthPages = allPages.filter(p => !(p.kind === 'scoped' && isAuthPageName(p.name)));

    // Auth pages: render directly in root (full-screen, no wrapper)
    if (authPages.length > 0) {
      if (useLazy) {
        lines.push(`  <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]"></div></div>}>`);
        for (const pn of authPages) {
          const jsx = generateJSX(pn, ctx, analysis, ROOT_SCOPE, 4);
          if (jsx) lines.push(jsx);
        }
        lines.push('  </Suspense>');
      } else {
        for (const pn of authPages) {
          const jsx = generateJSX(pn, ctx, analysis, ROOT_SCOPE, 2);
          if (jsx) lines.push(jsx);
        }
      }
    }

    // Non-auth pages: wrap in constrained container behind auth gate
    if (nonAuthPages.length > 0) {
      lines.push('  {isAuthed && (');
      if (hasSidebar) {
        lines.push('    <div className="flex min-h-screen">');
      } else if (wrapperClass) {
        lines.push(`    <div className="${wrapperClass}">`);
      }
      const innerIndent = hasSidebar || wrapperClass ? 6 : 4;
      if (useLazy) {
        const suspenseIndent = ' '.repeat(innerIndent);
        lines.push(`${suspenseIndent}<Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]"></div></div>}>`);
        for (const pn of nonAuthPages) {
          const jsx = generateJSX(pn, ctx, analysis, ROOT_SCOPE, innerIndent + 2);
          if (jsx) lines.push(jsx);
        }
        lines.push(`${suspenseIndent}</Suspense>`);
      } else {
        for (const pn of nonAuthPages) {
          const jsx = generateJSX(pn, ctx, analysis, ROOT_SCOPE, innerIndent);
          if (jsx) lines.push(jsx);
        }
      }
      if (hasSidebar || wrapperClass) {
        lines.push('    </div>');
      }
      lines.push('  )}');
    }

    lines.push('</div>');
    return lines;
  }

  if (hasSidebar) {
    lines.push('  <div className="flex min-h-screen">');
  } else if (wrapperClass) {
    lines.push(`  <div className="${wrapperClass}">`);
  }

  const contentIndent = hasSidebar || wrapperClass ? 4 : 2;

  // Wrap page content in Suspense for lazy-loaded pages
  if (useLazy && analysis.hasPages) {
    const suspenseIndent = ' '.repeat(contentIndent);
    lines.push(`${suspenseIndent}<Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent)]"></div></div>}>`);
    for (const node of ctx.uiNodes) {
      const jsx = generateJSX(node, ctx, analysis, ROOT_SCOPE, contentIndent + 2);
      if (jsx) lines.push(jsx);
    }
    lines.push(`${suspenseIndent}</Suspense>`);
  } else {
    for (const node of ctx.uiNodes) {
      const jsx = generateJSX(node, ctx, analysis, ROOT_SCOPE, contentIndent);
      if (jsx) lines.push(jsx);
    }
  }

  if (hasSidebar || wrapperClass) {
    lines.push('  </div>');
  }

  lines.push('</div>');
  return lines;
}

/** Recursively extract @page scoped nodes from a binary tree */
function extractScopedPages(node: AirUINode): AirUINode[] {
  if (node.kind === 'scoped' && node.scope === 'page') return [node];
  if (node.kind === 'binary') {
    return [...extractScopedPages(node.left), ...extractScopedPages(node.right)];
  }
  if (node.kind === 'element' && node.children) {
    const pages: AirUINode[] = [];
    for (const child of node.children) {
      pages.push(...extractScopedPages(child));
    }
    return pages;
  }
  return [];
}

// ---- Core JSX Generator ----

export function generateJSX(
  node: AirUINode,
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  switch (node.kind) {
    case 'text':
      return `${pad}{${interpolateText(node.text, ctx, scope)}}`;

    case 'value':
      return `${pad}{${JSON.stringify(node.value)}}`;

    case 'element':
      return generateElementJSX(node, ctx, analysis, scope, ind);

    case 'scoped':
      return generateScopedJSX(node, ctx, analysis, scope, ind);

    case 'unary':
      return generateUnaryJSX(node, ctx, analysis, scope, ind);

    case 'binary':
      return generateBinaryJSX(node, ctx, analysis, scope, ind);
  }
}

// ---- Element JSX ----

export function generateElementJSX(
  node: AirUINode & { kind: 'element' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);
  const mapping = mapElement(node.element, []);

  // Special elements
  if (node.element === 'tabs') {
    return generateTabsElement(node, ctx, analysis, scope, ind);
  }
  if (node.element === 'pagination') {
    return `${pad}<div className="flex gap-2 items-center justify-center mt-4">\n${pad}  <button className="px-3 py-1 rounded border border-[var(--border-input)] hover:bg-[var(--hover)]">&laquo; Prev</button>\n${pad}  <span className="px-3 py-1">1</span>\n${pad}  <button className="px-3 py-1 rounded border border-[var(--border-input)] hover:bg-[var(--hover)]">Next &raquo;</button>\n${pad}</div>`;
  }
  if (node.element === 'spinner') {
    return `${pad}<div className="${mapping.className}"></div>`;
  }
  if (node.element === 'logo') {
    return `${pad}<div className="${mapping.className}">&#9889;</div>`;
  }
  if (node.element === 'table') {
    return generateTableElement(node, ctx, analysis, scope, ind);
  }
  // stateVar.select → select dropdown for enum state
  if (node.element.endsWith('.select')) {
    const stateVar = node.element.replace('.select', '');
    const stateField = findStateField(stateVar, ctx);
    const options = stateField?.type.kind === 'enum' ? stateField.type.values : [];
    if (options.length > 0) {
      return `${pad}<select className="border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent" value={${stateVar}} onChange={(e) => set${capitalize(stateVar)}(e.target.value)}>\n`
        + options.map(o => `${pad}  <option value="${o}">${capitalize(o)}</option>`).join('\n') + '\n'
        + `${pad}</select>`;
    }
  }

  // Grid element with first child as modifier (grid:3 appears as first child)
  if (node.element === 'grid' && node.children && node.children.length > 0) {
    let gridChildren = node.children;
    let gridMapping = mapping;
    const first = gridChildren[0];
    if (first.kind === 'binary' && first.operator === ':') {
      const bindRes = resolveBindChain(first);
      if (bindRes && bindRes.element === 'grid' && bindRes.binding?.kind === 'value') {
        const cols = String(bindRes.binding.value);
        gridMapping = mapElement('grid', [cols]);
        gridChildren = gridChildren.slice(1);
      }
    }
    // Wrap compose (+) children in a div so each becomes one grid cell
    const childJsx = gridChildren.map(c => {
      if (c.kind === 'binary' && c.operator === '+') {
        const inner = generateJSX(c, ctx, analysis, scope, ind + 4);
        return `${pad}  <div className="flex flex-col gap-4">\n${inner}\n${pad}  </div>`;
      }
      return generateJSX(c, ctx, analysis, scope, ind + 2);
    }).filter(Boolean).join('\n');
    return `${pad}<${gridMapping.tag} className="${gridMapping.className}">\n${childJsx}\n${pad}</${gridMapping.tag}>`;
  }

  // Plan element — render as pricing card with structured children
  if (node.element === 'plan' && node.children && node.children.length > 0) {
    return generatePlanElement(node, ctx, analysis, scope, ind);
  }

  // Stat grid: row of all stat children → responsive grid
  if (node.element === 'row' && node.children && node.children.length > 1) {
    const allStats = node.children.every(c => {
      const resolved = tryResolveElement(c);
      if (resolved && resolved.element === 'stat') return true;
      // Walk through flow (>) chains to detect stat
      if (c.kind === 'binary' && c.operator === '>') {
        const leftResolved = tryResolveElement(c.left);
        if (leftResolved && leftResolved.element === 'stat') return true;
      }
      return false;
    });
    if (allStats) {
      const cols = node.children.length;
      const gridClass = cols <= 2 ? 'grid grid-cols-2 gap-4'
        : cols <= 3 ? 'grid grid-cols-1 md:grid-cols-3 gap-4'
        : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4';
      const childJsx = node.children.map(c =>
        generateJSX(c, ctx, analysis, scope, ind + 2)
      ).filter(Boolean).join('\n');
      return `${pad}<div className="${gridClass}">\n${childJsx}\n${pad}</div>`;
    }
  }

  // Element with children
  if (node.children && node.children.length > 0) {
    // Form: find primary action, set formAction in scope so primary button becomes type="submit"
    if (node.element === 'form') {
      const firstAction = findFirstFormAction(node.children);
      const formScope: Scope = { ...scope, insideForm: true, formAction: firstAction || undefined };
      const childJsx = node.children.map(c =>
        generateJSX(c, ctx, analysis, formScope, ind + 2)
      ).filter(Boolean).join('\n');
      const onSubmitAttr = firstAction
        ? ` onSubmit={(e) => { e.preventDefault(); ${firstAction}(e); }}`
        : '';
      // Inject auth error alert inside login/register forms
      const isAuthFormAction = firstAction === 'login' || firstAction === 'register' || firstAction === 'signup';
      const hasAuthRoutesForm = ctx.auth !== null || (ctx.hasBackend && ctx.expandedRoutes.some(r => r.path.endsWith('/login') || r.path.endsWith('/signup') || r.path.endsWith('/register')));
      const authAlertForm = isAuthFormAction && hasAuthRoutesForm
        ? `\n${pad}  {authError && <div className="rounded-[var(--radius)] bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 text-sm">{authError}</div>}`
        : '';
      // T1.4: Inject "Forgot Password?" link after login forms when forgot-password route exists
      const hasForgotRoute = ctx.hasBackend && ctx.expandedRoutes.some(r =>
        r.method === 'POST' && (r.path.endsWith('/forgot-password') || r.path.endsWith('/reset-password'))
      );
      const forgotPasswordLink = (firstAction === 'login' && hasForgotRoute)
        ? `\n${pad}  <div className="text-center mt-2"><button type="button" className="text-sm text-[var(--accent)] hover:underline" onClick={() => setCurrentPage('forgotPassword')}>Forgot Password?</button></div>`
        : '';
      return `${pad}<form${classAttr(mapping.className)}${onSubmitAttr}>${authAlertForm}\n${childJsx}\n${pad}</form>${forgotPasswordLink}`;
    }

    const childScope = scope;
    const childJsx = node.children.map(c =>
      generateJSX(c, ctx, analysis, childScope, ind + 2)
    ).filter(Boolean).join('\n');

    if (mapping.className) {
      return `${pad}<${mapping.tag} className="${mapping.className}">\n${childJsx}\n${pad}</${mapping.tag}>`;
    }
    return `${pad}<${mapping.tag}>\n${childJsx}\n${pad}</${mapping.tag}>`;
  }

  // Self-closing or empty
  if (mapping.selfClosing) {
    const typeAttr = mapping.inputType ? ` type="${mapping.inputType}"` : '';
    const nameAttr = scope.insideForm ? ` name="${mapping.inputType || 'text'}"` : '';
    return `${pad}<${mapping.tag}${typeAttr}${nameAttr} className="${mapping.className}" />`;
  }

  if (mapping.className) {
    return `${pad}<${mapping.tag} className="${mapping.className}"></${mapping.tag}>`;
  }
  return `${pad}<${mapping.tag}></${mapping.tag}>`;
}

// ---- Scoped JSX (pages and sections) ----

export function generateScopedJSX(
  node: AirUINode & { kind: 'scoped' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  if (node.scope === 'page') {
    // For fullstack apps with extracted page components, render component reference
    if (ctx.hasBackend) {
      return generatePageComponentRef(node, ctx, analysis, ind);
    }

    // Frontend-only: render pages inline (unchanged behavior)
    const isFormPage = pageHasFormContent(node);

    const childJsx = node.children.map(c =>
      generateJSX(c, ctx, analysis, scope, isFormPage ? ind + 8 : ind + 4)
    ).filter(Boolean).join('\n');

    if (isFormPage) {
      return `${pad}{currentPage === '${node.name}' && (\n`
        + `${pad}  <div className="flex items-center justify-center min-h-screen p-4">\n`
        + `${pad}    <div className="w-full max-w-md space-y-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-8">\n`
        + `${pad}      <h2 className="text-2xl font-bold text-center">${capitalize(node.name)}</h2>\n`
        + `${childJsx}\n`
        + `${pad}    </div>\n`
        + `${pad}  </div>\n`
        + `${pad})}`;
    }

    return `${pad}{currentPage === '${node.name}' && (\n${pad}  <div>\n${childJsx}\n${pad}  </div>\n${pad})}`;
  }

  if (node.scope === 'section') {
    const sectionClasses = (() => {
      switch (node.name) {
        case 'hero': return 'py-28 px-6 space-y-8 text-center';
        case 'footer': return 'py-8 px-6 space-y-4 border-t border-[var(--border)] text-center';
        case 'cta': return 'py-20 px-6 space-y-6 text-center';
        default: return scope.insideSidebarPage ? 'py-4 space-y-4' : (analysis.hasPages ? 'py-8 px-6 space-y-6' : 'py-20 px-6 space-y-6 text-center');
      }
    })();
    const childJsx = node.children.map(c =>
      generateJSX(c, ctx, analysis, scope, ind + 2)
    ).filter(Boolean).join('\n');

    return `${pad}<section id="${node.name}" className="${sectionClasses}">\n${childJsx}\n${pad}</section>`;
  }

  return '';
}

export function pageHasFormContent(node: AirUINode & { kind: 'scoped' }): boolean {
  for (const child of node.children) {
    if (child.kind === 'element' && child.element === 'form') return true;
    // form > !action pattern
    if (child.kind === 'binary' && child.operator === '>') {
      const left = child.left;
      if (left.kind === 'element' && left.element === 'form') return true;
      // Also check resolved element
      const resolved = tryResolveElement(left);
      if (resolved && resolved.element === 'form') return true;
    }
  }
  return false;
}

/**
 * Render a page as a component reference: <DashboardPage prop1={val} ... />
 * Computes which props the page needs, excluding hook-covered state vars.
 *
 * When _hasAuthGating is true:
 * - Auth pages get simplified props (login/authError/setCurrentPage)
 * - Data pages get isAuthed gate + user/logout/currentPage/setCurrentPage
 */
function generatePageComponentRef(
  node: AirUINode & { kind: 'scoped' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  ind: number,
): string {
  const pad = ' '.repeat(ind);
  const pageName = capitalize(node.name);
  const isAuth = isAuthPageName(node.name);
  const ctxHasAuth = hasAuthRoutes(ctx);

  if (_hasAuthGating) {
    // ---- Auth-gated mode: simplified props ----
    if (isAuth) {
      // Auth pages: only auth-related props, no isAuthed gate
      const propAssignments: string[] = [];
      // Pass mutation props detected by tree walk
      const deps = analyzePageDependencies(node.children, ctx, analysis);
      for (const m of deps.mutationProps) {
        const safeName = m.replace(/\./g, '_');
        propAssignments.push(`${safeName}={${safeName}}`);
      }
      if (!propAssignments.some(p => p.startsWith('authError='))) {
        propAssignments.push('authError={authError}');
      }
      if (!propAssignments.some(p => p.startsWith('setCurrentPage='))) {
        propAssignments.push('setCurrentPage={setCurrentPage}');
      }
      const propsStr = propAssignments.length > 0 ? ' ' + propAssignments.join(' ') : '';
      return `${pad}{currentPage === '${node.name}' && (\n${pad}  <${pageName}Page${propsStr} />\n${pad})}`;
    } else {
      // Data pages: require isAuthed, pass user/logout/nav props
      const propAssignments = [
        'user={user}',
        'logout={logout}',
        'currentPage={currentPage}',
        'setCurrentPage={setCurrentPage}',
      ];
      // C1/G3: Check if this page's model has nested routes → pass setter for detail navigation
      if (ctx.db) {
        const pageNameLower = node.name.toLowerCase();
        for (const model of ctx.db.models) {
          const modelPlural = model.name.toLowerCase().endsWith('s') ? model.name.toLowerCase() : model.name.toLowerCase() + 's';
          if (pageNameLower === modelPlural || pageNameLower.includes(model.name.toLowerCase())) {
            const hasNestedRoutes = ctx.expandedRoutes.some(r => {
              const nestedMatch = r.path.match(/^\/(\w+)\/:id\/(\w+)$/);
              return nestedMatch && nestedMatch[1] === modelPlural && r.method === 'GET';
            });
            if (hasNestedRoutes) {
              propAssignments.push(`setSelected${model.name}Id={setSelected${model.name}Id}`);
            }
          }
        }
      }
      const propsStr = ' ' + propAssignments.join(' ');
      let result = `${pad}{isAuthed && currentPage === '${node.name}' && (\n${pad}  <${pageName}Page${propsStr} />\n${pad})}`;

      // C1/G3: Add detail page conditional rendering
      if (ctx.db) {
        const pageNameLower = node.name.toLowerCase();
        for (const model of ctx.db.models) {
          const modelPlural = model.name.toLowerCase().endsWith('s') ? model.name.toLowerCase() : model.name.toLowerCase() + 's';
          if (pageNameLower === modelPlural || pageNameLower.includes(model.name.toLowerCase())) {
            const hasNestedRoutes = ctx.expandedRoutes.some(r => {
              const nestedMatch = r.path.match(/^\/(\w+)\/:id\/(\w+)$/);
              return nestedMatch && nestedMatch[1] === modelPlural && r.method === 'GET';
            });
            if (hasNestedRoutes) {
              const detailProps = `${model.name.charAt(0).toLowerCase() + model.name.slice(1)}Id={selected${model.name}Id} onBack={() => setSelected${model.name}Id(null)} user={user} logout={logout} currentPage={currentPage} setCurrentPage={setCurrentPage}`;
              result += `\n${pad}{isAuthed && currentPage === '${node.name}' && selected${model.name}Id && (\n${pad}  <${model.name}DetailPage ${detailProps} />\n${pad})}`;
            }
          }
        }
      }
      return result;
    }
  }

  // ---- Original full-prop mode ----
  const deps = analyzePageDependencies(node.children, ctx, analysis);
  const hookMap = getHookableStateProps(ctx);

  // Build prop assignments, excluding hook-covered state vars
  const propAssignments: string[] = [];
  for (const s of deps.stateProps) {
    if (hookMap.has(s)) continue; // data comes from hook in the page component
    propAssignments.push(`${s}={${s}}`);
    propAssignments.push(`set${capitalize(s)}={set${capitalize(s)}}`);
  }
  for (const s of deps.setterProps) {
    if (hookMap.has(s)) continue;
    const setName = `set${capitalize(s)}`;
    const assignment = `${setName}={${setName}}`;
    if (!propAssignments.includes(assignment)) propAssignments.push(assignment);
  }
  for (const m of deps.mutationProps) {
    const safeName = m.replace(/\./g, '_');
    propAssignments.push(`${safeName}={${safeName}}`);
  }
  if (deps.needsNav) {
    if (!propAssignments.some(p => p.startsWith('currentPage='))) {
      propAssignments.push('currentPage={currentPage}');
    }
    if (!propAssignments.some(p => p.startsWith('setCurrentPage='))) {
      propAssignments.push('setCurrentPage={setCurrentPage}');
    }
  }

  // Pass authError props for login/register pages
  if (isAuth && ctxHasAuth) {
    if (!propAssignments.some(p => p.startsWith('authError='))) {
      propAssignments.push('authError={authError}');
    }
    if (!propAssignments.some(p => p.startsWith('setAuthError='))) {
      propAssignments.push('setAuthError={setAuthError}');
    }
  }

  const propsStr = propAssignments.length > 0
    ? ' ' + propAssignments.join(' ')
    : '';

  return `${pad}{currentPage === '${node.name}' && (\n${pad}  <${pageName}Page${propsStr} />\n${pad})}`;
}

// ---- Unary JSX ----

export function generateUnaryJSX(
  node: AirUINode & { kind: 'unary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  switch (node.operator) {
    case '#': {
      // State reference
      const expr = resolveRef(node.operand, scope);
      return `${pad}{${expr}}`;
    }

    case '!': {
      // Mutation — render as button with onClick
      const name = extractActionName(node.operand);
      const args = extractActionArgs(node.operand, scope);
      const typeAttr = scope.insideForm ? ' type="button"' : '';
      return `${pad}<button${typeAttr} className="bg-[var(--accent)] text-white px-4 py-2 rounded-[var(--radius)] cursor-pointer hover:opacity-90 transition-colors" onClick={() => ${name}(${args})}>${name}</button>`;
    }

    case '*': {
      // Iteration
      return generateIterationJSX(node, ctx, analysis, scope, ind);
    }

    case '?': {
      // Conditional
      const condition = resolveRef(node.operand, scope);
      return `${pad}{${condition} && (`
        + `\n${pad}  ${generateJSX(node.operand, ctx, analysis, scope, ind + 2).trim()}`
        + `\n${pad})}`;
    }

    case '$': {
      // Currency display
      const inner = resolveRef(node.operand, scope);
      return `${pad}{'$' + (${inner}).toFixed(2)}`;
    }

    case '~': {
      // Async stub
      return `${pad}{/* TODO: async ${nodeToString(node.operand)} */}`;
    }

    case '^': {
      // Emit stub
      return `${pad}{/* TODO: emit ${nodeToString(node.operand)} */}`;
    }

    default:
      return `${pad}{/* unknown unary: ${node.operator} */}`;
  }
}

// ---- Binary JSX ----

export function generateBinaryJSX(
  node: AirUINode & { kind: 'binary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  switch (node.operator) {
    case '+':
      return generateComposeJSX(node, ctx, analysis, scope, ind);

    case '>':
      return generateFlowJSX(node, ctx, analysis, scope, ind);

    case '|':
      return generatePipeJSX(node, ctx, analysis, scope, ind);

    case ':':
      return generateBindJSX(node, ctx, analysis, scope, ind);

    case '.':
      return generateDotJSX(node, ctx, analysis, scope, ind);

    default:
      return `${pad}{/* unknown binary: ${node.operator} */}`;
  }
}

// ---- Compose (+) ----

export function generateComposeJSX(
  node: AirUINode & { kind: 'binary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // Pattern: header>text + right → merge into header
  if (node.left.kind === 'binary' && node.left.operator === '>') {
    const leftResolved = tryResolveElement(node.left.left);
    if (leftResolved && leftResolved.element === 'header') {
      const mapping = mapElement('header', []);
      const rightResolved = tryResolveElement(node.right.kind === 'binary' && node.right.operator === ':' ? node.right : node.right);
      const isBadge = rightResolved && rightResolved.element === 'badge';
      const isAction = node.right.kind === 'unary' && node.right.operator === '!';
      const isBtn = rightResolved && (rightResolved.element === 'btn' || rightResolved.element === 'button');

      // Wrap header text in <h1>
      let titleJsx: string;
      if (node.left.right.kind === 'text') {
        titleJsx = `${pad}  <h1 className="text-xl font-bold">${escapeText(node.left.right.text)}</h1>`;
      } else {
        titleJsx = generateJSX(node.left.right, ctx, analysis, scope, ind + 2);
      }
      const rightContent = generateJSX(node.right, ctx, analysis, scope, isBadge ? ind + 4 : ind + 2);

      if (isBadge) {
        // Group title + badge together on the left
        return `${pad}<${mapping.tag} className="${mapping.className}">\n`
          + `${pad}  <div className="flex items-center gap-3">\n`
          + `${titleJsx.replace(new RegExp(`^${pad}  `), `${pad}    `)}\n`
          + `${rightContent.replace(new RegExp(`^(\\s*)`), `${pad}    `)}\n`
          + `${pad}  </div>\n`
          + `${pad}</${mapping.tag}>`;
      }
      return `${pad}<${mapping.tag} className="${mapping.className}">\n${titleJsx}\n${rightContent}\n${pad}</${mapping.tag}>`;
    }
  }

  // Check if both sides are inline-level elements → wrap in flex row
  const leftResolved = tryResolveElement(node.left);
  const rightResolved = tryResolveElement(node.right);
  const INLINE_ELEMENTS = new Set(['p', 'text', 'span', 'badge', 'btn', 'button', 'a', 'link', 'icon', 'logo']);
  const leftInline = leftResolved && INLINE_ELEMENTS.has(leftResolved.element);
  const rightInline = rightResolved && INLINE_ELEMENTS.has(rightResolved.element);

  // Also treat action (!) and flow chains resolving to inline as inline
  const leftIsInline = leftInline || (node.left.kind === 'text') || (node.left.kind === 'unary' && node.left.operator === '!');
  const rightIsInline = rightInline || (node.right.kind === 'text') || (node.right.kind === 'unary' && node.right.operator === '!');

  if (leftIsInline && rightIsInline) {
    const left = generateJSX(node.left, ctx, analysis, scope, ind + 2);
    const right = generateJSX(node.right, ctx, analysis, scope, ind + 2);
    return `${pad}<div className="flex items-center gap-2">\n${left}\n${right}\n${pad}</div>`;
  }

  const left = generateJSX(node.left, ctx, analysis, scope, ind);
  const right = generateJSX(node.right, ctx, analysis, scope, ind);
  return [left, right].filter(Boolean).join('\n');
}

// ---- Flow (>) ----

export function generateFlowJSX(
  node: AirUINode & { kind: 'binary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // Pattern: ?condition > content → conditional rendering
  if (node.left.kind === 'unary' && node.left.operator === '?') {
    const condition = resolveRef(node.left.operand, scope);
    const content = generateJSX(node.right, ctx, analysis, scope, ind + 2);
    return `${pad}{${condition} && (\n${content}\n${pad})}`;
  }

  // Pattern: element > !mutation → element with event handler
  if (node.right.kind === 'unary' && node.right.operator === '!') {
    return generateElementWithAction(node.left, node.right, ctx, analysis, scope, ind);
  }

  // Pattern: element > *iter(...) → container with iteration
  if (node.right.kind === 'unary' && node.right.operator === '*') {
    // Check if left is itself a flow chain: list > (items|filter) then this > *iter
    const dataSource = extractDataSource(node.left, scope, ctx);
    return generateContainerWithIteration(node.left, dataSource, node.right, ctx, analysis, scope, ind);
  }

  // Pattern: element > text → element with text child
  if (node.right.kind === 'text') {
    const leftResolved = tryResolveElement(node.left);
    if (leftResolved) {
      const mapping = mapElement(leftResolved.element, leftResolved.modifiers);

      // Nav button → page navigation with active styling
      if (scope.insideNav && (leftResolved.element === 'btn' || leftResolved.element === 'button')) {
        const pageName = node.right.text.toLowerCase();
        return `${pad}<button className={\`w-full text-left px-3 py-2 rounded-[var(--radius)] cursor-pointer transition-colors \${currentPage === '${pageName}' ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--hover)]'}\`} onClick={() => setCurrentPage('${pageName}')}>${escapeText(node.right.text)}</button>`;
      }

      // CTA button outside nav → match text to page name for navigation
      if (!scope.insideNav && (leftResolved.element === 'btn' || leftResolved.element === 'button') && analysis.hasPages) {
        const ctaTarget = matchCtaToPage(node.right.text, ctx, analysis);
        if (ctaTarget) {
          return `${pad}<button${classAttr(mapping.className)} onClick={() => setCurrentPage('${ctaTarget}')}>${escapeText(node.right.text)}</button>`;
        }
      }

      // img/a: text becomes src/href attribute, not children
      if (mapping.tag === 'img') {
        return `${pad}<img src="${escapeAttr(node.right.text)}"${classAttr(mapping.className)} alt="${escapeAttr(leftResolved.modifiers[0] || 'image')}" />`;
      }
      if (mapping.tag === 'a') {
        const textContent = node.right.text;
        // Extract href from bind label (link:/signup > "Create account" → href="/signup", text="Create account")
        let href = '#';
        if (node.left.kind === 'binary' && node.left.operator === ':') {
          const bindInfo = resolveBindChain(node.left);
          if (bindInfo?.label) href = bindInfo.label;
        }
        // For page-based navigation, internal paths use setCurrentPage
        if (href.startsWith('/') && analysis.hasPages) {
          const pageName = href.slice(1);
          return `${pad}<a href="#"${classAttr(mapping.className)} onClick={(e) => { e.preventDefault(); setCurrentPage('${pageName}'); }}>${escapeText(textContent)}</a>`;
        }
        const external = (href.startsWith('http') || href.endsWith('.html'))
          ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `${pad}<a href="${escapeAttr(href)}"${classAttr(mapping.className)}${external}>${escapeText(textContent)}</a>`;
      }
      const textContent = node.right.text.includes('#')
        ? `{${interpolateText(node.right.text, ctx, scope)}}`
        : escapeText(node.right.text);
      // Header with heading child (e.g., header>h1>"Settings"): wrap text in <h1>
      if (leftResolved.element === 'header' && leftResolved.children?.some(c => c.kind === 'element' && /^h[1-6]$/.test(c.element))) {
        return `${pad}<${mapping.tag}${classAttr(mapping.className)}>\n${pad}  <h1 className="text-xl font-bold">${textContent}</h1>\n${pad}</${mapping.tag}>`;
      }
      return `${pad}<${mapping.tag}${classAttr(mapping.className)}>${textContent}</${mapping.tag}>`;
    }
  }

  // Pattern: element > $#ref → element displaying currency value
  if (node.right.kind === 'unary' && node.right.operator === '$') {
    const leftResolved = tryResolveElement(node.left);
    if (leftResolved) {
      const inner = node.right.operand;
      const ref = resolveRef(inner.kind === 'unary' && inner.operator === '#' ? inner.operand : inner, scope);
      if (leftResolved.element === 'stat' && node.left.kind === 'binary' && node.left.operator === ':') {
        const bindInfo = resolveBindChain(node.left);
        if (bindInfo?.label) {
          const mapping = mapElement('stat', []);
          return `${pad}<div className="${mapping.className}">\n${pad}  <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">${escapeText(bindInfo.label)}</div>\n${pad}  <div className="text-2xl font-bold">{'$' + (${ref}).toFixed(2)}</div>\n${pad}</div>`;
        }
      }
      return `${pad}<span>{'$' + ${ref}}</span>`;
    }
  }

  // Pattern: element > #ref → element bound to / displaying state
  if (node.right.kind === 'unary' && node.right.operator === '#') {
    const leftResolved = tryResolveElement(node.left);
    if (leftResolved) {
      const ref = resolveRef(node.right.operand, scope, ctx);
      // For stat elements, extract the label from the bind chain
      if (leftResolved.element === 'stat' && node.left.kind === 'binary' && node.left.operator === ':') {
        const bindInfo = resolveBindChain(node.left);
        if (bindInfo?.label) {
          const mapping = mapElement('stat', []);
          // C1/G2: Format numeric stat values with toFixed when referencing float/numeric fields
          const refStr = String(ref);
          const isNumericRef = refStr.includes('avg') || refStr.includes('Avg') || refStr.includes('rate') || refStr.includes('Rate') ||
            refStr.includes('time') || refStr.includes('Time') || refStr.includes('duration') || refStr.includes('Duration');
          const displayRef = isNumericRef ? `typeof (${ref}) === 'number' ? (${ref}).toFixed(1) : (${ref})` : ref;
          return `${pad}<div className="${mapping.className}">\n${pad}  <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">${escapeText(bindInfo.label)}</div>\n${pad}  <div className="text-2xl font-bold">{${displayRef}}</div>\n${pad}</div>`;
        }
      }
      return generateFlowBoundElement(leftResolved, ref, ctx, scope, ind);
    }
  }

  // Pattern: element > binary(.) (state.property access or state.set pattern)
  if (node.right.kind === 'binary' && node.right.operator === '.') {
    return generateFlowWithDot(node.left, node.right, ctx, analysis, scope, ind);
  }

  // Pattern: element > binary(|) → element displaying piped value
  if (node.right.kind === 'binary' && node.right.operator === '|') {
    const leftResolved = tryResolveElement(node.left);
    if (leftResolved) {
      const mapping = mapElement(leftResolved.element, leftResolved.modifiers);
      const expr = resolvePipeExpr(node.right, ctx, scope);
      // Stat: show label + piped value
      if (leftResolved.element === 'stat') {
        const resolved = node.left.kind === 'binary' && node.left.operator === ':' ? resolveBindChain(node.left) : null;
        const label = resolved?.label || '';
        return `${pad}<div className="${mapping.className}">\n${pad}  <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">${escapeText(label)}</div>\n${pad}  <div className="text-2xl font-bold">{${expr}}</div>\n${pad}</div>`;
      }
      return `${pad}<${mapping.tag}${classAttr(mapping.className)}>{${expr}}</${mapping.tag}>`;
    }
  }

  // Pattern: element > stateVar.set(options) → tabs or select with setter
  if (node.right.kind === 'element' && node.right.element.includes('.set')) {
    return generateSetterElement(node.left, node.right, ctx, analysis, scope, ind);
  }

  // Pattern: element > stateVar.select → selector for enum state
  if (node.right.kind === 'element' && node.right.element.endsWith('.select')) {
    const stateVar = node.right.element.replace('.select', '');
    const stateField = findStateField(stateVar, ctx);
    const options = stateField?.type.kind === 'enum' ? stateField.type.values : [];
    return `${pad}<select className="border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent" value={${stateVar}} onChange={(e) => set${capitalize(stateVar)}(e.target.value)}>\n`
      + options.map(o => `${pad}  <option value="${o}">${capitalize(o)}</option>`).join('\n') + '\n'
      + `${pad}</select>`;
  }

  // Pattern: nested flow chains (left is also a >)
  if (node.left.kind === 'binary' && node.left.operator === '>') {
    // Chain: a > b > c — the right side is nested content for the chain
    return generateFlowChain(node, ctx, analysis, scope, ind);
  }

  // Generic: left element, right as child
  const leftResolved = tryResolveElement(node.left);
  if (leftResolved) {
    const mapping = mapElement(leftResolved.element, leftResolved.modifiers);
    // Nav with page navigation — pass insideNav scope so child buttons get onClick
    const childScope = leftResolved.element === 'nav' && analysis.hasPages
      ? { ...scope, insideNav: true } as Scope
      : scope;
    const childJsx = generateJSX(node.right, ctx, analysis, childScope, ind + 2);
    return `${pad}<${mapping.tag}${classAttr(mapping.className)}>\n${childJsx}\n${pad}</${mapping.tag}>`;
  }

  // Fallback: render both sides
  const left = generateJSX(node.left, ctx, analysis, scope, ind);
  const right = generateJSX(node.right, ctx, analysis, scope, ind + 2);
  return `${left}\n${right}`;
}

// ---- Pipe (|) ----

export function generatePipeJSX(
  node: AirUINode & { kind: 'binary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // If left is a bind chain (e.g., badge:$#expenses | sum), extract element + pipe the value
  if (node.left.kind === 'binary' && node.left.operator === ':') {
    const resolved = resolveBindChain(node.left);
    if (resolved) {
      const mapping = mapElement(resolved.element, resolved.modifiers);
      // Build a pipe node using just the binding value as source
      const valueNode = resolved.binding || resolved.action || node.left;
      const pipeExpr = resolvePipeExpr({ kind: 'binary', operator: '|', left: valueNode, right: node.right }, ctx, scope);
      if (resolved.element === 'stat') {
        return `${pad}<div className="${mapping.className}">\n${pad}  <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">${escapeText(resolved.label || '')}</div>\n${pad}  <div className="text-2xl font-bold">{${pipeExpr}}</div>\n${pad}</div>`;
      }
      return `${pad}<${mapping.tag}${classAttr(mapping.className)}>{${pipeExpr}}</${mapping.tag}>`;
    }
  }

  const expr = resolvePipeExpr(node, ctx, scope);
  return `${pad}{${expr}}`;
}

// ---- Bind (:) ----

export function generateBindJSX(
  node: AirUINode & { kind: 'binary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);
  const resolved = resolveBindChain(node);
  if (!resolved) {
    return `${pad}{/* unresolved bind */}`;
  }

  const mapping = mapElement(resolved.element, resolved.modifiers);

  // Progress bar: generate bar with percentage
  if (resolved.element === 'progress' && resolved.children && resolved.children.length > 0) {
    return generateProgressBar(resolved, ctx, scope, ind);
  }

  // Element with action
  if (resolved.action) {
    const actionName = extractActionName(resolved.action.kind === 'unary' ? resolved.action.operand : resolved.action);
    const actionArgs = extractActionArgs(
      resolved.action.kind === 'unary' ? resolved.action.operand : resolved.action,
      scope,
    );
    if (mapping.tag === 'button') {
      // Delete/remove actions inside iteration → compact icon button
      const isDel = actionName === 'del' || actionName === 'delete' || actionName === 'remove';
      let btnClass: string;
      if (isDel && scope.insideIter) {
        btnClass = mapElement('btn', ['icon']).className;
      } else if (resolved.element === 'btn' && resolved.modifiers.length === 0) {
        btnClass = mapElement('btn', ['ghost']).className;
      } else {
        btnClass = mapping.className;
      }
      // Primary form action → type="submit" (form's onSubmit handles the call)
      if (scope.insideForm && scope.formAction === actionName) {
        return `${pad}<button type="submit" className="${btnClass}">${getButtonLabel(resolved)}</button>`;
      }
      const typeAttr = scope.insideForm ? ' type="button"' : '';
      return `${pad}<button${typeAttr} className="${btnClass}" onClick={() => ${actionName}(${actionArgs})}>${getButtonLabel(resolved)}</button>`;
    }
    return `${pad}<${mapping.tag} className="${mapping.className}" onClick={() => ${actionName}(${actionArgs})} />`;
  }

  // Element with binding
  if (resolved.binding) {
    return generateBoundElement(resolved, mapping, ctx, analysis, scope, ind);
  }

  // Element with label (stat:"Total")
  if (resolved.label !== undefined) {
    if (resolved.element === 'stat') {
      return `${pad}<div className="${mapping.className}">\n${pad}  <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">${escapeText(resolved.label)}</div>\n${pad}  <div className="text-2xl font-bold">--</div>\n${pad}</div>`;
    }
    return `${pad}<${mapping.tag} className="${mapping.className}">${escapeText(resolved.label)}</${mapping.tag}>`;
  }

  // Nav with page items — render as navigation buttons with setCurrentPage
  if (resolved.element === 'nav' && resolved.children && resolved.children.length > 0 && analysis.hasPages) {
    const navItems: { label: string; page: string }[] = [];
    for (const child of resolved.children) {
      // btn:ghost>"Dashboard" → flow chain: left=bind(btn:ghost), right=text("Dashboard")
      if (child.kind === 'binary' && child.operator === '>') {
        const text = child.right.kind === 'text' ? child.right.text : '';
        if (text) { navItems.push({ label: text, page: text.toLowerCase() }); continue; }
      }
      // Plain element fallback (btn without flow)
      if (child.kind === 'element') {
        navItems.push({ label: capitalize(child.element), page: child.element });
      }
      // Bind chain: btn:ghost (no text) — use element name
      const childResolved = tryResolveElement(child);
      if (childResolved && !navItems.some(n => n.page === childResolved.element)) {
        navItems.push({ label: capitalize(childResolved.element), page: childResolved.element });
      }
    }
    if (navItems.length > 0) {
      const itemsJsx = navItems.map(({ label, page }) =>
        `${pad}  <button className={\`w-full text-left px-3 py-2 rounded-[var(--radius)] cursor-pointer transition-colors \${currentPage === '${page}' ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--hover)]'}\`} onClick={() => setCurrentPage('${page}')}>${escapeText(label)}</button>`
      ).join('\n');
      return `${pad}<${mapping.tag}${classAttr(mapping.className)}>\n${itemsJsx}\n${pad}</${mapping.tag}>`;
    }
  }

  // Icon — render with emoji or modifier name
  if (resolved.element === 'icon') {
    const iconName = resolved.modifiers[0] || '';
    const emoji = ICON_EMOJI[iconName] || iconName;
    return `${pad}<span className="${mapping.className}">${emoji}</span>`;
  }

  // Chart — render polished placeholder with icon
  if (resolved.element === 'chart') {
    const chartType = capitalize(resolved.modifiers[0] || 'chart');
    return `${pad}<div className="${mapping.className}">\n`
      + `${pad}  <div className="flex flex-col items-center gap-2 text-[var(--muted)]">\n`
      + `${pad}    <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>\n`
      + `${pad}      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />\n`
      + `${pad}    </svg>\n`
      + `${pad}    <span className="text-sm">${chartType} chart</span>\n`
      + `${pad}  </div>\n`
      + `${pad}</div>`;
  }

  // Pre/code:block — join text children as multi-line code block
  if (mapping.tag === 'pre' && resolved.children && resolved.children.length > 0) {
    const codeLines: string[] = [];
    for (const c of resolved.children) {
      if (c.kind === 'text') codeLines.push((c as any).text ?? (c as any).value ?? '');
      else if (c.kind === 'element') codeLines.push(c.element);
    }
    const joined = codeLines.join('\\n');
    return `${pad}<${mapping.tag}${classAttr(mapping.className)}>{\`${joined.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`}</${mapping.tag}>`;
  }

  // Element with children from resolved bind
  if (resolved.children && resolved.children.length > 0) {
    const childJsx = resolved.children.map(c =>
      generateJSX(c, ctx, analysis, scope, ind + 2)
    ).filter(Boolean).join('\n');
    return `${pad}<${mapping.tag}${classAttr(mapping.className)}>\n${childJsx}\n${pad}</${mapping.tag}>`;
  }

  // Simple styled element
  if (mapping.selfClosing) {
    const typeAttr = mapping.inputType ? ` type="${mapping.inputType}"` : '';
    const resolvedName = resolved.modifiers[0] || mapping.inputType || resolved.element;
    const nameAttr = scope.insideForm ? ` name="${resolvedName}"` : '';
    // Smart placeholder based on element type/name
    let placeholder = '';
    if (resolved.element === 'search') {
      placeholder = ' placeholder="Search..."';
    } else if (resolved.element === 'input' && mapping.inputType) {
      const label = resolved.modifiers[0] ? capitalize(resolved.modifiers[0]) : capitalize(mapping.inputType);
      placeholder = ` placeholder="${escapeAttr(label === 'Text' ? 'Enter value' : label)}..."`;
    }
    return `${pad}<${mapping.tag}${typeAttr}${nameAttr}${classAttr(mapping.className)}${placeholder} />`;
  }

  return `${pad}<${mapping.tag}${classAttr(mapping.className)}></${mapping.tag}>`;
}

// ---- Dot (.) ----

export function generateDotJSX(
  node: AirUINode & { kind: 'binary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // Pattern: stateVar.select → select dropdown for enum state
  if (node.right.kind === 'element' && node.right.element === 'select') {
    const stateVar = node.left.kind === 'element' ? node.left.element : '';
    if (stateVar) {
      const stateField = findStateField(stateVar, ctx);
      const options = stateField?.type.kind === 'enum' ? stateField.type.values : [];
      if (options.length > 0) {
        return `${pad}<select className="border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent" value={${stateVar}} onChange={(e) => set${capitalize(stateVar)}(e.target.value)}>\n`
          + options.map(o => `${pad}  <option value="${o}">${capitalize(o)}</option>`).join('\n') + '\n'
          + `${pad}</select>`;
      }
    }
  }

  const expr = resolveDotExpr(node, scope, ctx);
  return `${pad}{${expr}}`;
}

// ---- Helpers ----

export function generateProgressBar(
  resolved: ResolvedBind,
  ctx: TranspileContext,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);
  // Extract value and max from children (which are config params like value:#expr, max:#expr)
  let valueExpr = '0';
  let maxExpr = '100';
  for (const child of resolved.children ?? []) {
    if (child.kind === 'binary' && child.operator === '|') {
      // Chained pipe: value:#expenses|sum(amount)
      // Left side is bind(value, #expenses), right side is sum(amount)
      if (child.left.kind === 'binary' && child.left.operator === ':') {
        const bindResolved = resolveBindChain(child.left);
        if (bindResolved && (bindResolved.element === 'value' || bindResolved.modifiers.includes('value'))) {
          const src = bindResolved.binding ? resolveRefNode(bindResolved.binding, scope) : '0';
          valueExpr = resolvePipeExprFromSourceAndRight(src, child.right, ctx, scope);
        }
      }
    } else if (child.kind === 'binary' && child.operator === ':') {
      const bindResolved = resolveBindChain(child);
      if (bindResolved) {
        if (bindResolved.element === 'value' && bindResolved.binding) {
          valueExpr = resolveRefNode(bindResolved.binding, scope);
        } else if (bindResolved.element === 'max' && bindResolved.binding) {
          maxExpr = resolveRefNode(bindResolved.binding, scope);
        }
      }
    }
  }
  return `${pad}<div className="w-full bg-[var(--hover)] rounded-full h-3 overflow-hidden">\n`
    + `${pad}  <div className="h-full bg-[var(--accent)] rounded-full transition-all" style={{ width: \`\${Math.min(100, (${valueExpr}) / (${maxExpr}) * 100)}%\` }}></div>\n`
    + `${pad}</div>`;
}

export function resolvePipeExprFromSourceAndRight(src: string, right: AirUINode, ctx: TranspileContext, scope: Scope): string {
  if (right.kind === 'element') {
    const fn = right.element;
    const args = right.children?.map(c => c.kind === 'element' ? c.element : nodeToString(c)) ?? [];
    if (fn === 'sum' && args.length > 0) return `${src}.reduce((s, x) => s + x.${args[0]}, 0)`;
    if (fn === 'avg' && args.length > 0) return `(${src}.length ? ${src}.reduce((s, x) => s + x.${args[0]}, 0) / ${src}.length : 0)`;
  }
  return src;
}

export function generateBoundElement(
  resolved: ResolvedBind,
  mapping: ReturnType<typeof mapElement>,
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);
  const binding = resolved.binding!;

  // Checkbox bound to boolean
  if (resolved.element === 'check' || mapping.inputType === 'checkbox') {
    const ref = resolveRef(binding.kind === 'unary' ? binding.operand : binding, scope);
    if (scope.insideIter && scope.iterVar) {
      const arrayName = scope.baseArray || 'items';
      // Extract the boolean field name from the ref (e.g., "item.done" → "done")
      const boolField = ref.includes('.') ? ref.split('.').pop() : 'done';
      return `${pad}<input type="checkbox" checked={${ref}} onChange={() => ${setter(arrayName)}(prev => prev.map(_i => _i.id === ${scope.iterVar}.id ? { ..._i, ${boolField}: !_i.${boolField} } : _i))} />`;
    }
    return `${pad}<input type="checkbox" checked={${ref}} onChange={() => ${setter(ref)}(!${ref})} />`;
  }

  // Input bound to state
  if (mapping.tag === 'input' || resolved.element === 'search') {
    const ref = resolveRef(binding.kind === 'unary' ? binding.operand : binding, scope, ctx);
    const typeAttr = mapping.inputType ? ` type="${mapping.inputType}"` : '';
    const plainRef = ref.replace(/\?\./, '.');
    const resolvedFieldName = plainRef.includes('.') ? plainRef.split('.').pop()! : (resolved.modifiers[0] || resolved.element);
    const nameAttr = scope.insideForm ? ` name="${resolvedFieldName}"` : '';
    // Auth forms (login/register) use uncontrolled inputs — FormData reads values on submit
    const isAuthForm = scope.insideForm && (scope.formAction === 'login' || scope.formAction === 'register' || scope.formAction === 'signup');
    const valueExpr = ref !== plainRef ? `${ref} ?? ''` : ref;
    // Smart placeholder: "Search..." for search-related inputs, contextual for others
    const isSearchLike = resolved.element === 'search' || resolvedFieldName === 'search' || resolvedFieldName === 'input' || mapping.inputType === 'search';
    const placeholderText = isSearchLike
      ? 'Search...'
      : (resolvedFieldName === 'password' ? 'Enter password...'
        : resolvedFieldName === 'email' ? 'Enter email...'
        : `${capitalize(resolvedFieldName)}...`);
    const inputJsx = isAuthForm
      ? `${pad}<input${typeAttr}${nameAttr} className="${mapping.className}" placeholder="${placeholderText}" />`
      : `${pad}<input${typeAttr}${nameAttr} className="${mapping.className}" value={${valueExpr}} onChange={(e) => ${resolveSetterFromRef(plainRef)}(e.target.value)} placeholder="${placeholderText}" />`;
    if (scope.insideForm) {
      const label = deriveLabel(resolvedFieldName);
      return wrapFormGroup(inputJsx, label, pad);
    }
    return inputJsx;
  }

  // Select bound to state
  if (resolved.element === 'select') {
    const ref = resolveRef(binding.kind === 'unary' ? binding.operand : binding, scope, ctx);
    const plainRef = ref.replace(/\?\./g, '.');
    const stateField = findStateField(ref, ctx);
    let options: string[] = stateField?.type.kind === 'enum' ? stateField.type.values : [];
    // Fall back to node children as options (e.g. select:#workspace.plan(free,pro,enterprise))
    if (options.length === 0 && resolved.children && resolved.children.length > 0) {
      options = resolved.children.map(c => c.kind === 'element' ? c.element : nodeToString(c));
    }
    // Also check binding operand children (parser attaches options there)
    if (options.length === 0) {
      const operand = binding.kind === 'unary' ? binding.operand : binding;
      const deepChildren = operand.kind === 'binary' && operand.operator === '.'
        ? (operand.right as AirUINode & { children?: AirUINode[] }).children
        : (operand as AirUINode & { children?: AirUINode[] }).children;
      if (deepChildren && deepChildren.length > 0) {
        options = deepChildren.map((c: AirUINode) => c.kind === 'element' ? c.element : nodeToString(c));
      }
    }
    const valueExpr = ref !== plainRef ? `${ref} ?? ''` : ref;
    const optionsJsx = options.map(o => `${pad}    <option value="${o}">${capitalize(o)}</option>`).join('\n');
    return `${pad}<select className="${mapping.className}" value={${valueExpr}} onChange={(e) => ${resolveSetterFromRef(plainRef)}(e.target.value)}>\n${optionsJsx}\n${pad}</select>`;
  }

  // Badge showing value
  if (resolved.element === 'badge') {
    const ref = resolveRefNode(binding, scope);
    return `${pad}<span className="${mapping.className}">{${ref}}</span>`;
  }

  // Text/span showing value
  if (resolved.element === 'text' || resolved.element === 'p') {
    const ref = resolveRefNode(binding, scope);
    const hasCurrency = binding.kind === 'unary' && binding.operator === '$';
    // Inside iteration, text takes remaining space
    const iterClass = scope.insideIter ? ' flex-1' : '';
    const cls = mapping.className ? mapping.className + iterClass : iterClass.trim();
    if (hasCurrency) {
      const inner = resolveRef(binding.operand, scope);
      return `${pad}<${mapping.tag}${classAttr(cls)}>{'$' + ${inner}}</${mapping.tag}>`;
    }
    return `${pad}<${mapping.tag}${classAttr(cls)}>{${ref}}</${mapping.tag}>`;
  }

  // Stat element with label and value
  if (resolved.element === 'stat' && resolved.label !== undefined) {
    const ref = resolveRefNode(binding, scope);
    // C1/G2: Format numeric stat values with toFixed when referencing float/numeric fields
    const refStr = String(ref);
    const isNumericRef = refStr.includes('avg') || refStr.includes('Avg') || refStr.includes('rate') || refStr.includes('Rate') ||
      refStr.includes('time') || refStr.includes('Time') || refStr.includes('duration') || refStr.includes('Duration');
    const displayRef = isNumericRef ? `typeof (${ref}) === 'number' ? (${ref}).toFixed(1) : (${ref})` : ref;
    return `${pad}<div className="${mapping.className}">\n${pad}  <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">${escapeText(resolved.label)}</div>\n${pad}  <div className="text-2xl font-bold">{${displayRef}}</div>\n${pad}</div>`;
  }

  // Image with src
  if (resolved.element === 'img') {
    const src = binding.kind === 'text' ? binding.text
      : binding.kind === 'element' ? binding.element
      : nodeToString(binding);
    return `${pad}<img src="${escapeAttr(src)}" alt="${escapeAttr(resolved.modifiers[0] || 'image')}" className="${mapping.className}" />`;
  }

  // Link with href
  if (resolved.element === 'link') {
    const href = binding.kind === 'text' ? binding.text
      : binding.kind === 'element' ? binding.element
      : '#';
    const externalLink = href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `${pad}<a href="${escapeAttr(href.startsWith('/') ? '#' + href : href)}" className="${mapping.className}"${externalLink}>`;
  }

  // Generic: render element displaying the binding value
  const ref = resolveRefNode(binding, scope);
  if (mapping.selfClosing) {
    return `${pad}<${mapping.tag}${classAttr(mapping.className)} value={${ref}} />`;
  }
  return `${pad}<${mapping.tag}${classAttr(mapping.className)}>{${ref}}</${mapping.tag}>`;
}

export function generateElementWithAction(
  element: AirUINode,
  action: AirUINode & { kind: 'unary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);
  const actionName = extractActionName(action.operand);
  const actionArgs = extractActionArgs(action.operand, scope);

  const resolved = tryResolveElement(element);
  if (!resolved) {
    return `${pad}<button onClick={() => ${actionName}(${actionArgs})}>${actionName}</button>`;
  }

  const mapping = mapElement(resolved.element, resolved.modifiers);

  // Form with submission
  if (resolved.element === 'form') {
    const formScope = { ...scope, insideForm: true };
    const childJsx = resolved.children
      ? resolved.children.map(c => generateJSX(c, ctx, analysis, formScope, ind + 2)).filter(Boolean).join('\n')
      : '';
    // Inject auth error alert inside login/register forms
    const isAuthForm = actionName === 'login' || actionName === 'register' || actionName === 'signup';
    const hasAuthRoutes = ctx.auth !== null || (ctx.hasBackend && ctx.expandedRoutes.some(r => r.path.endsWith('/login') || r.path.endsWith('/signup') || r.path.endsWith('/register')));
    const authAlert = isAuthForm && hasAuthRoutes
      ? `\n${pad}  {authError && <div className="rounded-[var(--radius)] bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 text-sm">{authError}</div>}`
      : '';
    return `${pad}<form className="${mapping.className}" onSubmit={(e) => { e.preventDefault(); ${actionName}(${actionArgs}); }}>${authAlert}\n${childJsx}\n${pad}</form>`;
  }

  // Button with onClick
  if (mapping.tag === 'button') {
    const label = resolved.children
      ? resolved.children.map(c => {
          if (c.kind === 'text') return escapeText(c.text);
          return '';
        }).join('')
      : actionName;
    // Primary form action → type="submit" (form's onSubmit handles the call)
    if (scope.insideForm && scope.formAction === actionName) {
      return `${pad}<button type="submit" className="${mapping.className}">${label || actionName}</button>`;
    }
    const typeAttr = scope.insideForm ? ' type="button"' : '';
    return `${pad}<button${typeAttr} className="${mapping.className}" onClick={() => ${actionName}(${actionArgs})}>${label || actionName}</button>`;
  }

  // Input with onKeyDown enter handler + visible action button
  if (mapping.tag === 'input') {
    const typeAttr = mapping.inputType ? ` type="${mapping.inputType}"` : '';
    const btnLabel = capitalize(actionName);
    // Button args: replace e.target.value with _inp.value (e.target in button context is the button, not the input)
    const btnArgs = actionArgs ? actionArgs.replace(/e\.target\.value/g, '_inp.value') : '_inp.value';
    return `${pad}<div className="flex gap-2">\n`
      + `${pad}  <input${typeAttr} className="${mapping.className} flex-1" placeholder="Add..." onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value) { ${actionName}(${actionArgs || 'e.target.value'}); e.target.value = ''; } }} />\n`
      + `${pad}  <button className="bg-[var(--accent)] text-white px-4 py-2.5 rounded-[var(--radius)] cursor-pointer hover:opacity-90 transition-colors" onClick={(e) => { const _inp = e.currentTarget.previousElementSibling; if (_inp?.value) { ${actionName}(${btnArgs}); _inp.value = ''; } }}>${btnLabel}</button>\n`
      + `${pad}</div>`;
  }

  // Generic element with onClick
  const childJsx = resolved.children
    ? '\n' + resolved.children.map(c => generateJSX(c, ctx, analysis, scope, ind + 2)).filter(Boolean).join('\n') + '\n' + pad
    : '';
  return `${pad}<${mapping.tag}${classAttr(mapping.className)} onClick={() => ${actionName}(${actionArgs})}>${childJsx}</${mapping.tag}>`;
}

export function generateIterationJSX(
  node: AirUINode & { kind: 'unary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // Extract iteration variable name and children
  let iterVar = 'item';
  let children: AirUINode[] = [];
  if (node.operand.kind === 'element') {
    iterVar = node.operand.element;
    children = node.operand.children ?? [];
  }

  // Data source: look at parent context (passed from flow handler)
  const dataExpr = scope.iterData || 'items';
  const newScope: Scope = { iterVar, iterData: dataExpr, insideIter: true };

  const childJsx = children.map(c =>
    generateJSX(c, ctx, analysis, newScope, ind + 4)
  ).filter(Boolean).join('\n');

  const emptyLabel = deriveEmptyLabel(dataExpr);
  // Skip styled wrapper when children contain a card element (avoid double-wrapping)
  const hasCardChild = children.some(c => c.kind === 'element' && c.element === 'card');
  const iterItemClass = hasCardChild ? '' : ' className="list-row"';
  return `${pad}{${dataExpr}.length === 0 ? (\n${pad}  <div className="empty-state">${emptyLabel}</div>\n${pad}) : ${dataExpr}.map((${iterVar}) => (\n${pad}  <div key={${iterVar}.id}${iterItemClass}>\n${childJsx}\n${pad}  </div>\n${pad}))}`;
}

export function generateContainerWithIteration(
  leftNode: AirUINode,
  dataSource: string,
  iterNode: AirUINode & { kind: 'unary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // Extract the container element from the left side
  let containerElement = 'div';
  let containerClass = '';

  if (leftNode.kind === 'binary' && leftNode.operator === '>') {
    // Chain: container > dataExpr
    const containerResolved = tryResolveElement(leftNode.left);
    if (containerResolved) {
      const mapping = mapElement(containerResolved.element, containerResolved.modifiers);
      containerElement = mapping.tag;
      containerClass = mapping.className;
    }
  } else {
    const containerResolved = tryResolveElement(leftNode);
    if (containerResolved) {
      const mapping = mapElement(containerResolved.element, containerResolved.modifiers);
      containerElement = mapping.tag;
      containerClass = mapping.className;
    }
  }

  // Generate iteration inside the container
  let iterVar = 'item';
  let children: AirUINode[] = [];
  if (iterNode.operand.kind === 'element') {
    iterVar = iterNode.operand.element;
    children = iterNode.operand.children ?? [];
  }

  // Extract base array name for mutations (e.g., "items" from "items.filter(...)")
  const baseArray = extractBaseArrayName(leftNode);
  const newScope: Scope = { iterVar, iterData: dataSource, baseArray, insideIter: true };

  const childJsx = children.map(c =>
    generateJSX(c, ctx, analysis, newScope, ind + 4)
  ).filter(Boolean).join('\n');

  const emptyLabel = deriveEmptyLabel(dataSource);
  const hasCardChild = children.some(c => c.kind === 'element' && c.element === 'card');
  const iterItemClass = hasCardChild ? '' : ' className="list-row"';
  return `${pad}<${containerElement}${classAttr(containerClass)}>\n`
    + `${pad}  {${dataSource}.length === 0 ? (\n`
    + `${pad}    <div className="empty-state">${emptyLabel}</div>\n`
    + `${pad}  ) : ${dataSource}.map((${iterVar}) => (\n`
    + `${pad}    <div key={${iterVar}.id}${iterItemClass}>\n`
    + `${childJsx}\n`
    + `${pad}    </div>\n`
    + `${pad}  ))}\n`
    + `${pad}</${containerElement}>`;
}

export function generateFlowBoundElement(
  resolved: { element: string; modifiers: string[]; children?: AirUINode[] },
  stateRef: string,
  ctx: TranspileContext,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);
  const mapping = mapElement(resolved.element, resolved.modifiers);
  const plainRef = stateRef.replace(/\?\./g, '.');
  const setterExpr = resolveSetterFromRef(plainRef);

  // Input: value + onChange
  if (mapping.tag === 'input' || resolved.element === 'search') {
    const typeAttr = mapping.inputType ? ` type="${mapping.inputType}"` : '';
    const resolvedFieldName = plainRef.includes('.') ? plainRef.split('.').pop()! : (resolved.modifiers[0] || resolved.element);
    const nameAttr = scope.insideForm ? ` name="${resolvedFieldName}"` : '';
    const valueExpr = stateRef !== plainRef ? `${stateRef} ?? ''` : stateRef;
    // Smart placeholder based on context
    const isSearchLike = resolved.element === 'search' || resolvedFieldName === 'search' || resolvedFieldName === 'input' || mapping.inputType === 'search';
    const placeholderText = isSearchLike ? 'Search...'
      : (resolvedFieldName === 'password' ? 'Enter password...'
        : resolvedFieldName === 'email' ? 'Enter email...'
        : `${capitalize(resolvedFieldName)}...`);
    // Auth forms (login/register) use uncontrolled inputs — FormData reads values on submit
    const isAuthForm = scope.insideForm && (scope.formAction === 'login' || scope.formAction === 'register' || scope.formAction === 'signup');
    const inputJsx = isAuthForm
      ? `${pad}<input${typeAttr}${nameAttr} className="${mapping.className}" placeholder="${placeholderText}" />`
      : `${pad}<input${typeAttr}${nameAttr} className="${mapping.className}" value={${valueExpr}} onChange={(e) => ${setterExpr}(e.target.value)} placeholder="${placeholderText}" />`;
    if (scope.insideForm) {
      const label = deriveLabel(resolvedFieldName);
      return wrapFormGroup(inputJsx, label, pad);
    }
    return inputJsx;
  }

  // Select: value + onChange with enum options
  if (resolved.element === 'select') {
    const enumValues = findEnumValues(stateRef, resolved.modifiers, ctx);
    const optionsJsx = enumValues.map(o => `${pad}  <option value="${o}">${capitalize(o)}</option>`).join('\n');
    return `${pad}<select className="${mapping.className}" value={${stateRef}} onChange={(e) => ${setterExpr}(e.target.value)}>\n${optionsJsx}\n${pad}</select>`;
  }

  // Tabs: generate button group from enum values
  if (resolved.element === 'tabs') {
    const enumValues = findEnumValues(stateRef, resolved.modifiers, ctx);
    if (enumValues.length > 0) {
      const optionsStr = enumValues.map(o => JSON.stringify(o)).join(', ');
      return `${pad}<div className="flex gap-1 p-1 bg-[var(--surface)] rounded-[var(--radius)]">\n`
        + `${pad}  {[${optionsStr}].map((_tab) => (\n`
        + `${pad}    <button key={_tab} className={\`px-4 py-2 rounded-[calc(var(--radius)-4px)] cursor-pointer transition-colors \${${stateRef} === _tab ? 'bg-[var(--accent)] text-white' : 'bg-transparent text-[var(--muted)] hover:text-[var(--fg)]'}\`} onClick={() => ${setterExpr}(_tab)}>{_tab.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase())}</button>\n`
        + `${pad}  ))}\n`
        + `${pad}</div>`;
    }
  }

  // Stat: display value
  if (resolved.element === 'stat') {
    const bindResolved = resolveBindChain({ kind: 'binary', operator: ':', left: { kind: 'element', element: resolved.element }, right: { kind: 'text', text: '' } } as any);
    return `${pad}<div className="${mapping.className}">\n${pad}  <div className="text-2xl font-bold">{${stateRef}}</div>\n${pad}</div>`;
  }

  // Generic: display value
  if (mapping.selfClosing) {
    return `${pad}<${mapping.tag}${classAttr(mapping.className)} value={${stateRef}} />`;
  }
  return `${pad}<${mapping.tag}${classAttr(mapping.className)}>{${stateRef}}</${mapping.tag}>`;
}

export function generateSetterElement(
  leftNode: AirUINode,
  rightNode: AirUINode & { kind: 'element' },
  ctx: TranspileContext,
  _analysis: UIAnalysis,
  _scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);
  const stateVar = rightNode.element.replace('.set', '');
  const options = rightNode.children?.map(c =>
    c.kind === 'element' ? c.element : nodeToString(c)
  ) ?? [];

  const leftResolved = tryResolveElement(leftNode);

  if (leftResolved?.element === 'tabs' || leftResolved?.element === 'row') {
    // Tabs: render buttons for each option
    const optionsStr = options.map(o => JSON.stringify(o)).join(', ');
    return `${pad}<div className="flex gap-1 p-1 bg-[var(--surface)] rounded-[var(--radius)]">\n`
      + `${pad}  {[${optionsStr}].map((_tab) => (\n`
      + `${pad}    <button key={_tab} className={\`px-4 py-2 rounded-[calc(var(--radius)-4px)] cursor-pointer transition-colors \${${stateVar} === _tab ? 'bg-[var(--accent)] text-white' : 'bg-transparent text-[var(--muted)] hover:text-[var(--fg)]'}\`} onClick={() => set${capitalize(stateVar)}(_tab)}>{_tab.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase())}</button>\n`
      + `${pad}  ))}\n`
      + `${pad}</div>`;
  }

  if (leftResolved?.element === 'select') {
    return `${pad}<select className="border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent" value={${stateVar}} onChange={(e) => set${capitalize(stateVar)}(e.target.value)}>\n`
      + options.map(o => `${pad}  <option value="${o}">${capitalize(o)}</option>`).join('\n') + '\n'
      + `${pad}</select>`;
  }

  // Generic: render as tab buttons
  const optionsStr = options.map(o => JSON.stringify(o)).join(', ');
  return `${pad}<div className="flex gap-1 p-1 bg-[var(--surface)] rounded-[var(--radius)]">\n`
    + `${pad}  {[${optionsStr}].map((_tab) => (\n`
    + `${pad}    <button key={_tab} className={\`px-4 py-2 rounded-[calc(var(--radius)-4px)] cursor-pointer transition-colors \${${stateVar} === _tab ? 'bg-[var(--accent)] text-white' : 'bg-transparent text-[var(--muted)] hover:text-[var(--fg)]'}\`} onClick={() => set${capitalize(stateVar)}(_tab)}>{_tab.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase())}</button>\n`
    + `${pad}  ))}\n`
    + `${pad}</div>`;
}

export function generateFlowWithDot(
  left: AirUINode,
  dot: AirUINode & { kind: 'binary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // Pattern: tabs > filter.set(options) → tab buttons
  const leftResolved = tryResolveElement(left);
  if (dot.left.kind === 'element' && dot.right.kind === 'element' && dot.right.element === 'set') {
    const stateVar = dot.left.element;
    const options = dot.right.children?.map(c => c.kind === 'element' ? c.element : nodeToString(c)) ?? [];

    if (leftResolved?.element === 'tabs') {
      const optionsStr = options.map(o => JSON.stringify(o)).join(', ');
      return `${pad}<div className="flex gap-1 p-1 bg-[var(--surface)] rounded-[var(--radius)]">\n`
        + `${pad}  {[${optionsStr}].map((_tab) => (\n`
        + `${pad}    <button key={_tab} className={\`px-4 py-2 rounded-[calc(var(--radius)-4px)] cursor-pointer transition-colors \${${stateVar} === _tab ? 'bg-[var(--accent)] text-white' : 'bg-transparent text-[var(--muted)] hover:text-[var(--fg)]'}\`} onClick={() => set${capitalize(stateVar)}(_tab)}>{_tab.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase())}</button>\n`
        + `${pad}  ))}\n`
        + `${pad}</div>`;
    }

    // select > stateVar.set → select with options
    if (leftResolved?.element === 'select') {
      const mapping = mapElement('select', []);
      return `${pad}<select className="${mapping.className}" value={${stateVar}} onChange={(e) => set${capitalize(stateVar)}(e.target.value)}>\n`
        + options.map(o => `${pad}  <option value="${o}">${capitalize(o)}</option>`).join('\n') + '\n'
        + `${pad}</select>`;
    }
  }

  // Pattern: stateName.select → selector for enum state
  if (dot.right.kind === 'element' && dot.right.element === 'select') {
    const stateVar = dot.left.kind === 'element' ? dot.left.element : '';
    if (stateVar) {
      const stateField = findStateField(stateVar, ctx);
      const options = stateField?.type.kind === 'enum' ? stateField.type.values : [];
      return `${pad}<select className="border border-[var(--border-input)] rounded-[var(--radius)] px-3 py-2 bg-transparent" value={${stateVar}} onChange={(e) => set${capitalize(stateVar)}(e.target.value)}>\n`
        + options.map(o => `${pad}  <option value="${o}">${capitalize(o)}</option>`).join('\n') + '\n'
        + `${pad}</select>`;
    }
  }

  // Generic: render left with dot expression as child
  if (leftResolved) {
    const mapping = mapElement(leftResolved.element, leftResolved.modifiers);
    const expr = resolveDotExpr(dot, scope, ctx);
    return `${pad}<${mapping.tag}${classAttr(mapping.className)}>{${expr}}</${mapping.tag}>`;
  }

  return `${pad}{${resolveDotExpr(dot, scope, ctx)}}`;
}

export function generateFlowChain(
  node: AirUINode & { kind: 'binary' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // Flatten the > chain
  const parts: AirUINode[] = [];
  let current: AirUINode = node;
  while (current.kind === 'binary' && current.operator === '>') {
    parts.push(current.right);
    current = current.left;
  }
  parts.push(current);
  parts.reverse();

  // parts[0] is the container, rest are content/data/iteration

  // Find container
  const containerResolved = tryResolveElement(parts[0]);

  // Find data source (pipe expressions)
  let dataExpr: string | null = null;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === 'binary' && part.operator === '|') {
      dataExpr = resolvePipeExpr(part, ctx, scope);
    } else if (part.kind === 'element') {
      // Could be a data reference (like 'items')
      const stateField = findStateField(part.element, ctx);
      if (stateField && stateField.type.kind === 'array') {
        dataExpr = stateField.name;
      }
    }
  }

  // Find iteration
  const iterPart = parts.find(p => p.kind === 'unary' && (p as AirUINode & { kind: 'unary' }).operator === '*');
  if (iterPart && iterPart.kind === 'unary') {
    // Extract base array name for mutations from data parts
    let baseArray = 'items';
    for (const p of parts) {
      if (p.kind === 'element') {
        const sf = findStateField(p.element, ctx);
        if (sf && sf.type.kind === 'array') { baseArray = sf.name; break; }
      }
    }
    const iterScope: Scope = { ...scope, iterData: dataExpr || baseArray, baseArray, insideIter: true };
    if (iterPart.operand.kind === 'element') {
      iterScope.iterVar = iterPart.operand.element;
    }

    const containerMapping = containerResolved ? mapElement(containerResolved.element, containerResolved.modifiers) : { tag: 'div', className: '' };

    let iterVar = iterScope.iterVar || 'item';
    let children = iterPart.operand.kind === 'element' ? (iterPart.operand.children ?? []) : [];

    const childJsx = children.map(c =>
      generateJSX(c, ctx, analysis, iterScope, ind + 4)
    ).filter(Boolean).join('\n');

    const iterDataExpr = dataExpr || 'items';
    const emptyLabel = deriveEmptyLabel(iterDataExpr);
    const hasCardChild = children.some(c => c.kind === 'element' && c.element === 'card');
    const iterItemClass = hasCardChild ? '' : ' className="flex gap-3 items-center bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] px-4 py-3"';
    return `${pad}<${containerMapping.tag}${classAttr(containerMapping.className)}>\n`
      + `${pad}  {${iterDataExpr}.length === 0 ? (\n`
      + `${pad}    <div className="empty-state">${emptyLabel}</div>\n`
      + `${pad}  ) : ${iterDataExpr}.map((${iterVar}) => (\n`
      + `${pad}    <div key={${iterVar}.id}${iterItemClass}>\n`
      + `${childJsx}\n`
      + `${pad}    </div>\n`
      + `${pad}  ))}\n`
      + `${pad}</${containerMapping.tag}>`;
  }

  // No iteration — just nested content
  const contentParts = parts.slice(1);
  const containerMapping = containerResolved ? mapElement(containerResolved.element, containerResolved.modifiers) : { tag: 'div', className: '' };
  const innerJsx = contentParts.map(c =>
    generateJSX(c, ctx, analysis, scope, ind + 2)
  ).filter(Boolean).join('\n');

  return `${pad}<${containerMapping.tag}${classAttr(containerMapping.className)}>\n${innerJsx}\n${pad}</${containerMapping.tag}>`;
}

export function generateTableElement(
  node: AirUINode & { kind: 'element' },
  ctx: TranspileContext,
  _analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // Extract column names and data source from children
  let columns: string[] = [];
  let dataSource = '';

  for (const child of node.children ?? []) {
    if (child.kind === 'binary' && child.operator === ':') {
      const resolved = resolveBindChain(child);
      if (resolved) {
        if (resolved.element === 'cols' && (resolved.binding || resolved.label)) {
          const rawText = resolved.label || (resolved.binding!.kind === 'text' ? resolved.binding!.text : nodeToString(resolved.binding!));
          columns = rawText.replace(/^\[+|\]+$/g, '').split(',').map(c => c.split(':')[0].trim()).filter(Boolean);
        } else if (resolved.element === 'data' && resolved.binding) {
          dataSource = resolveRefNode(resolved.binding, scope);
        }
      }
    }
    // data:#users|search — pipe wrapping a data bind
    if (child.kind === 'binary' && child.operator === '|') {
      if (child.left.kind === 'binary' && child.left.operator === ':') {
        const resolved = resolveBindChain(child.left);
        if (resolved?.element === 'data' && resolved.binding) {
          dataSource = resolvePipeExpr(child as AirUINode & { kind: 'binary' }, ctx, scope);
        }
      }
    }
  }

  if (columns.length === 0) {
    // Try to infer columns from @db model fields
    const inferred = inferModelFieldsFromDataSource(dataSource, ctx);
    if (inferred.length > 0) {
      columns = inferred;
    } else {
      columns = ['Column 1', 'Column 2', 'Column 3'];
    }
  }

  const emptyLabel = deriveEmptyLabel(dataSource);
  const headerCells = columns.map(c => `${pad}      <th>${capitalize(c)}</th>`).join('\n');
  const dataCells = columns.map(c => `${pad}          <td>{row.${c}}</td>`).join('\n');

  if (dataSource) {
    return `${pad}<table className="w-full">\n${pad}  <thead>\n${pad}    <tr>\n${headerCells}\n${pad}    </tr>\n${pad}  </thead>\n${pad}  <tbody>\n${pad}    {${dataSource}.length === 0 ? (\n${pad}      <tr><td colSpan={${columns.length}}><div className="empty-state">${emptyLabel}</div></td></tr>\n${pad}    ) : ${dataSource}.map((row) => (\n${pad}      <tr key={row.id}>\n${dataCells}\n${pad}      </tr>\n${pad}    ))}\n${pad}  </tbody>\n${pad}</table>`;
  }

  return `${pad}<table className="w-full">\n${pad}  <thead>\n${pad}    <tr>\n${headerCells}\n${pad}    </tr>\n${pad}  </thead>\n${pad}  <tbody>\n${pad}    <tr>\n${columns.map(c => `${pad}      <td>--</td>`).join('\n')}\n${pad}    </tr>\n${pad}  </tbody>\n${pad}</table>`;
}

export function generatePlanElement(
  node: AirUINode & { kind: 'element' },
  _ctx: TranspileContext,
  _analysis: UIAnalysis,
  _scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);
  const mapping = mapElement('plan', []);
  let name = '';
  let price = '';
  const features: string[] = [];

  for (const child of node.children ?? []) {
    if (child.kind === 'text') {
      const text = child.text;
      if (text.startsWith('[[') || text.startsWith('[')) {
        // Feature list: [[feat:5_apps,feat:community] → parse features
        const cleaned = text.replace(/^\[+|\]+$/g, '');
        for (const item of cleaned.split(',')) {
          const feat = item.trim().replace(/^feat:/, '').replace(/_/g, ' ');
          if (feat) features.push(feat);
        }
      } else if (!name) {
        name = text;
      }
    } else if (child.kind === 'value') {
      price = typeof child.value === 'number' ? (child.value === 0 ? 'Free' : `$${child.value}/mo`) : String(child.value);
    } else if (child.kind === 'element' && child.element === 'custom') {
      price = 'Custom';
    }
  }

  const lines = [`${pad}<div className="${mapping.className}">`];
  if (name) lines.push(`${pad}  <div className="text-lg font-semibold">${escapeText(name)}</div>`);
  if (price) lines.push(`${pad}  <div className="text-3xl font-bold">${escapeText(price)}</div>`);
  if (features.length > 0) {
    lines.push(`${pad}  <ul className="space-y-1 text-sm">`);
    for (const feat of features) {
      lines.push(`${pad}    <li>&#10004; ${escapeText(feat)}</li>`);
    }
    lines.push(`${pad}  </ul>`);
  }
  lines.push(`${pad}</div>`);
  return lines.join('\n');
}

export function generateTabsElement(
  node: AirUINode & { kind: 'element' },
  ctx: TranspileContext,
  analysis: UIAnalysis,
  scope: Scope,
  ind: number,
): string {
  const pad = ' '.repeat(ind);

  // tabs with children that are just option elements
  if (node.children && node.children.length > 0) {
    const options = node.children.map(c => {
      if (c.kind === 'element') return c.element;
      return nodeToString(c);
    });

    // Try to find a filter state
    const filterField = ctx.state.find(f => f.type.kind === 'enum');
    if (filterField) {
      const optionsStr = options.map(o => JSON.stringify(o)).join(', ');
      return `${pad}<div className="flex gap-1 p-1 bg-[var(--surface)] rounded-[var(--radius)]">\n`
        + `${pad}  {[${optionsStr}].map((_tab) => (\n`
        + `${pad}    <button key={_tab} className={\`px-4 py-2 rounded-[calc(var(--radius)-4px)] cursor-pointer transition-colors \${${filterField.name} === _tab ? 'bg-[var(--accent)] text-white' : 'bg-transparent text-[var(--muted)] hover:text-[var(--fg)]'}\`} onClick={() => set${capitalize(filterField.name)}(_tab)}>{_tab.replace(/_/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase())}</button>\n`
        + `${pad}  ))}\n`
        + `${pad}</div>`;
    }
  }

  return `${pad}<div className="flex gap-1 p-1 bg-[var(--surface)] rounded-[var(--radius)]">{/* tabs */}</div>`;
}

// ---- CTA-to-Page Matching ----

/** CTA synonym groups: keywords that map to a list of candidate page stems (ordered by priority) */
const CTA_SYNONYMS: [string[], string[]][] = [
  // keywords → candidate page names (first match wins)
  [['portfolio', 'work', 'gallery', 'projects'], ['gallery', 'portfolio']],
  [['book', 'session', 'schedule', 'appointment', 'touch', 'reach', 'inquire', 'inquiry', 'contact'], ['booking', 'contact', 'book']],
  [['package', 'pricing', 'price', 'plan'], ['packages', 'pricing']],
  [['faq', 'question', 'help'], ['faq']],
];

/**
 * Match CTA button text to a page name using page names and synonym heuristics.
 * Prefers public pages over admin pages.
 * Returns the target page name or null if no match.
 */
export function matchCtaToPage(
  text: string,
  ctx: TranspileContext,
  analysis: UIAnalysis,
): string | null {
  const allPageNames = analysis.pages.map(p => p.name);
  if (allPageNames.length === 0) return null;

  const publicPages = ctx.publicPageNames;
  const lower = text.toLowerCase();

  // 1. Exact match — button text IS a page name
  if (allPageNames.includes(lower)) return lower;

  // 2. Direct substring — only match public pages (CTAs target public pages)
  for (const page of publicPages) {
    if (lower.includes(page)) return page;
  }

  // 3. Synonym matching — CTA keywords map to candidate page names
  for (const [keywords, candidates] of CTA_SYNONYMS) {
    if (keywords.some(k => lower.includes(k))) {
      // Try candidates in priority order, prefer public pages
      for (const cand of candidates) {
        if (publicPages.includes(cand)) return cand;
      }
      for (const cand of candidates) {
        if (allPageNames.includes(cand)) return cand;
      }
    }
  }

  // 4. Fallback: direct substring against all pages (admin included)
  for (const page of allPageNames) {
    if (lower.includes(page)) return page;
  }

  return null;
}
