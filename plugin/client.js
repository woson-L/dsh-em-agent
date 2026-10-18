/* ============================================================================
 *  dsh-em-agent · 客户端半边（浏览器与桌面版渲染层通用，纯 JS、无构建步骤）
 *
 *  三件事：
 *    1) 应用一打开就自动弹出一个模态窗（每次打开都弹），交代入口与前置条件
 *    2) 顶栏（conversation.header.leading）放一枚触发片，关掉弹窗后还能再打开
 *    3) 中央主面板（main，keyed = 'em-agent'）用 iframe 承载控制台整页
 *
 *  为什么弹窗挂在 shell.overlay：
 *    那是「整帧浮层，盖住所有列、在滚动容器之外」的 seat。塞进顶栏会被列的
 *    滚动与层叠上下文裁掉，而且换个面板就消失。
 *
 *  为什么高度写 5cm：
 *    CSS 的 cm 是物理单位（1cm = 96/2.54 px，5cm ≈ 188.98px），不是估算值。
 *
 *  配色一律取宿主主题令牌（--dsw-alias-*），明暗两套自动跟随，不硬编码；
 *  圆角/字号/间距是这套入口自带的形状系统（弹窗 12 / 按钮 6 / 标记 4），
 *  只作用于本插件注入的类名，不碰宿主样式。
 * ========================================================================== */
window.__ModuleLoader__.load({
  id: 'dsh-em-agent',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** 与宿主 index.js 的 DEFAULT_ROUTE_PATH 保持一致。 */
    const ROUTE = '/em-agent';
    /** 与宿主 index.js 的 MARKER_HEADER 保持一致：只有真面板才会带。 */
    const MARKER = 'x-dsh-em-agent';
    const ORIGIN_META = 'dsh-em-agent-origin';
    /** 主面板键名，同时也是弹窗与胶囊共用的入口 id。 */
    const PANEL_ID = 'em-agent';
    const STYLE_ID = 'dsh-em-agent-styles';

    /* ---------------------------------------------------------------- 样式
     * 只定义本插件自己的类名；语义色全部取宿主令牌（带最小兜底），
     * 这样宿主换主题时不会与自带配色打架。
     * ---------------------------------------------------------------- */
    const STYLES = `
.dsh-em-agent-scrim{position:fixed;inset:0;display:grid;place-items:center;padding:24px;
  background:rgba(0,0,0,.36);z-index:60;animation:dsh-em-agent-fade 200ms cubic-bezier(.16,1,.3,1)}
.dsh-em-agent-dialog{position:relative;width:clamp(320px,calc(100vw - 48px),560px);height:5cm;
  display:flex;flex-direction:column;justify-content:space-between;
  padding:20px 20px 18px 22px;
  border:1px solid var(--dsw-alias-border-l1,#eaeaea);border-radius:12px;
  background:var(--dsw-alias-bg-overlay,#fff);
  box-shadow:0 28px 64px -36px rgba(0,0,0,.22),0 2px 6px -2px rgba(0,0,0,.06);
  animation:dsh-em-agent-rise 420ms cubic-bezier(.16,1,.3,1)}
.dsh-em-agent-close{position:absolute;top:10px;right:10px;width:28px;height:28px;
  display:grid;place-items:center;padding:0;border:1px solid transparent;border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-secondary,#6b6b66);
  font:400 16px/1 var(--dsw-font-sans,system-ui,sans-serif);cursor:pointer;
  transition:color 150ms cubic-bezier(.16,1,.3,1),background-color 150ms cubic-bezier(.16,1,.3,1),
    border-color 150ms cubic-bezier(.16,1,.3,1)}
.dsh-em-agent-close:hover{color:var(--dsw-alias-label-primary,#111);
  background:var(--dsw-alias-bg-layer-2,#fbfbfa);border-color:var(--dsw-alias-border-l1,#eaeaea)}
.dsh-em-agent-body{display:flex;flex-direction:column;gap:10px;padding-right:34px}
.dsh-em-agent-title{margin:0;font-size:16px;font-weight:600;letter-spacing:-.011em;line-height:1.3;
  color:var(--dsw-alias-label-primary,#111)}
.dsh-em-agent-sub{margin:3px 0 0;font-size:12.5px;line-height:1.45;letter-spacing:.005em;
  color:var(--dsw-alias-label-secondary,#6b6b66)}
.dsh-em-agent-note{margin:0;font-size:11.5px;line-height:1.4;
  color:var(--dsw-alias-label-secondary,#6b6b66)}
.dsh-em-agent-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px}
.dsh-em-agent-btn{height:34px;padding:0 14px;border-radius:6px;
  font:500 12.5px/1 var(--dsw-font-sans,system-ui,sans-serif);letter-spacing:.008em;cursor:pointer;
  transition:background-color 160ms cubic-bezier(.16,1,.3,1),
    border-color 160ms cubic-bezier(.16,1,.3,1),color 160ms cubic-bezier(.16,1,.3,1),
    transform 120ms cubic-bezier(.16,1,.3,1)}
.dsh-em-agent-btn:active{transform:scale(.985)}
.dsh-em-agent-btn--ghost{border:1px solid var(--dsw-alias-border-l1,#eaeaea);background:transparent;
  color:var(--dsw-alias-label-primary,#2f3437)}
.dsh-em-agent-btn--ghost:hover{border-color:var(--dsw-alias-border-l2,#dedcd6);
  background:var(--dsw-alias-bg-layer-2,#fbfbfa)}
.dsh-em-agent-btn--primary{border:1px solid var(--dsw-alias-label-primary,#111);
  background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-bg-overlay,#fff)}
.dsh-em-agent-btn--primary:hover{border-color:var(--dsw-alias-label-secondary,#333);
  background:var(--dsw-alias-label-secondary,#333)}
.dsh-em-agent-chip{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 10px;
  border:1px solid var(--dsw-alias-border-l1,#eaeaea);border-radius:6px;
  background:transparent;color:var(--dsw-alias-label-secondary,#2f3437);
  font:500 12px/1 var(--dsw-font-sans,system-ui,sans-serif);letter-spacing:.01em;cursor:pointer;
  transition:border-color 160ms cubic-bezier(.16,1,.3,1),
    background-color 160ms cubic-bezier(.16,1,.3,1),color 160ms cubic-bezier(.16,1,.3,1)}
.dsh-em-agent-chip:hover{border-color:var(--dsw-alias-border-l2,#dedcd6);
  background:var(--dsw-alias-bg-layer-2,#fbfbfa);color:var(--dsw-alias-label-primary,#111)}
.dsh-em-agent-chip:active{transform:scale(.985)}
.dsh-em-agent-chip-mark{width:4px;height:4px;border-radius:4px;
  background:var(--dsw-alias-label-secondary,#8a8a84)}
.dsh-em-agent-scrim :where(button):focus-visible{outline:2px solid var(--dsw-alias-label-primary,#111);
  outline-offset:2px}
.dsh-em-agent-chip:focus-visible{outline:2px solid var(--dsw-alias-label-primary,#111);outline-offset:2px}
@keyframes dsh-em-agent-fade{from{opacity:0}to{opacity:1}}
@keyframes dsh-em-agent-rise{from{opacity:0;transform:translateY(12px) scale(.995)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .dsh-em-agent-scrim,.dsh-em-agent-dialog,.dsh-em-agent-chip,.dsh-em-agent-btn,
  .dsh-em-agent-close{animation:none;transition:none}
  .dsh-em-agent-dialog{transform:none}
}
`;

    /** 宿主通过 webServer.tapIndex 注入的绝对 origin；读不到返回 null。 */
    function readInjectedOrigin() {
      try {
        const el = document.querySelector('meta[name="' + ORIGIN_META + '"]');
        const value = el && el.getAttribute('content');
        return value ? String(value).replace(/\/+$/, '') : null;
      } catch (e) {
        return null;
      }
    }

    /* 探测一次并缓存：HEAD 请求极轻，但没必要每次渲染都发。 */
    let resolved = null;

    async function resolvePanelSrc() {
      if (resolved) return resolved;
      try {
        const res = await fetch(ROUTE, {
          method: 'HEAD',
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (res.ok && res.headers.get(MARKER) === 'panel') {
          resolved = { src: ROUTE, reason: 'relative' };
          return resolved;
        }
      } catch (e) {
        /* 相对路径不通，落到底下的绝对 origin 兜底 */
      }
      const origin = readInjectedOrigin();
      if (origin) {
        resolved = { src: origin + ROUTE, reason: 'absolute' };
        return resolved;
      }
      resolved = { src: null, reason: 'unresolved' };
      return resolved;
    }

    /** 弹窗开合状态：胶囊、浮层弹窗、整页三处共用同一份。 */
    function createModalStore() {
      let open = false;
      const listeners = new Set();
      return {
        get() { return open; },
        set(next) {
          const value = next === true;
          if (value === open) return;
          open = value;
          listeners.forEach((fn) => {
            try { fn(); } catch (e) { /* 单个订阅者出错不拖累其它 */ }
          });
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => { listeners.delete(fn); };
        },
      };
    }

    function useModalState(store) {
      const pair = React.useState(store.get());
      const open = pair[0];
      const setOpen = pair[1];
      React.useEffect(() => store.subscribe(() => setOpen(store.get())), [store]);
      return open;
    }

    /** 弹窗内的可聚焦元素，用于把 Tab 关在弹窗里。 */
    function focusables(root) {
      if (!root) return [];
      const nodes = root.querySelectorAll(
        'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),' +
        'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      return Array.prototype.slice.call(nodes).filter((el) => el.offsetParent !== null);
    }

    const frameStyle = {
      flex: '1 1 auto',
      width: '100%',
      minHeight: '60vh',
      border: '0',
      display: 'block',
      background: 'transparent',
    };
    const barStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      borderBottom: '1px solid var(--dsw-alias-border-l1, #d9dee6)',
      color: 'var(--dsw-alias-label-primary, #1c2430)',
      flex: '0 0 auto',
    };
    const subStyle = {
      color: 'var(--dsw-alias-label-secondary, #5b6b7f)',
      fontSize: '12px',
    };

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        const modal = createModalStore();

        /* 样式随插件卸载一起撤掉，不往宿主 <head> 里留垃圾。 */
        ctx.effect(() => {
          let el = document.getElementById(STYLE_ID);
          if (!el) {
            el = document.createElement('style');
            el.id = STYLE_ID;
            el.textContent = STYLES;
            document.head.appendChild(el);
          }
          return () => {
            if (el && el.parentNode) el.parentNode.removeChild(el);
          };
        });

        /* ---------------------------------------------------------------
         * 1) 自动弹出：客户端一挂载就开，即「每次打开应用都弹」。
         *    留 140ms 让宿主先把界面铺好，免得第一帧就盖住还在渲染的视口。
         * ------------------------------------------------------------- */
        ctx.effect(() => {
          const timer = setTimeout(() => modal.set(true), 140);
          return () => clearTimeout(timer);
        });

        /* ---------------------------------------------------------------
         * 2) 浮层弹窗：遮罩 + 5cm 面板 + 焦点约束 + 右上角关闭
         * ------------------------------------------------------------- */
        function EmAgentModal() {
          const open = useModalState(modal);
          const dialogRef = React.useRef(null);
          const primaryRef = React.useRef(null);
          const restoreRef = React.useRef(null);

          React.useEffect(() => {
            if (!open) return undefined;

            restoreRef.current = document.activeElement;
            const html = document.documentElement;
            const prevOverflow = html.style.overflow;
            html.style.overflow = 'hidden';

            const focusTimer = setTimeout(() => {
              if (primaryRef.current) primaryRef.current.focus({ preventScroll: true });
            }, 0);

            const onKeyDown = (event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                modal.set(false);
                return;
              }
              if (event.key !== 'Tab') return;

              const nodes = focusables(dialogRef.current);
              if (!nodes.length) return;
              const first = nodes[0];
              const last = nodes[nodes.length - 1];
              const active = document.activeElement;
              const inside = dialogRef.current && dialogRef.current.contains(active);

              if (event.shiftKey && (active === first || !inside)) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
              }
            };

            document.addEventListener('keydown', onKeyDown, true);
            return () => {
              clearTimeout(focusTimer);
              document.removeEventListener('keydown', onKeyDown, true);
              html.style.overflow = prevOverflow;
              const back = restoreRef.current;
              if (back && typeof back.focus === 'function') back.focus({ preventScroll: true });
            };
          }, [open]);

          if (!open) return null;

          const close = () => modal.set(false);

          return h(
            'div',
            {
              className: 'dsh-em-agent-scrim',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) close();
              },
            },
            h(
              'div',
              {
                className: 'dsh-em-agent-dialog',
                ref: dialogRef,
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'dsh-em-agent-title',
                'aria-describedby': 'dsh-em-agent-sub',
              },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-em-agent-close',
                  'aria-label': '关闭',
                  title: '关闭',
                  onClick: close,
                },
                '\u00d7',
              ),
              h(
                'div',
                { className: 'dsh-em-agent-body' },
                h(
                  'div',
                  null,
                  h('h1', { id: 'dsh-em-agent-title', className: 'dsh-em-agent-title' }, 'EM Agent'),
                  h('p', { id: 'dsh-em-agent-sub', className: 'dsh-em-agent-sub' }, '硬件设计控制台'),
                ),
                h(
                  'p',
                  { className: 'dsh-em-agent-note' },
                  '需要本机 CST Studio Suite 2026 与 MCP 服务已就绪',
                ),
              ),
              h(
                'div',
                { className: 'dsh-em-agent-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-em-agent-btn dsh-em-agent-btn--ghost',
                    onClick: close,
                  },
                  '稍后再说',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    ref: primaryRef,
                    className: 'dsh-em-agent-btn dsh-em-agent-btn--primary',
                    onClick: () => {
                      close();
                      try {
                        ctx.layout.selectPanel(PANEL_ID);
                      } catch (e) {
                        /* 面板尚未注册时 selectPanel 会抛错，不打断关闭流程 */
                      }
                    },
                  },
                  '开启 EM 仿真',
                ),
              ),
            ),
          );
        }

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'em-agent-modal', order: 10 },
            EmAgentModal,
          ),
        );

        /* ---------------------------------------------------------------
         * 3) 顶栏触发片：关掉弹窗之后还能再打开
         *    注意 shell.leading 是「整窗左上角」，但宿主只在
         *    darwin && sidebarCollapsed 时挂载它，Windows 上不渲染，
         *    所以入口放在会话顶栏左侧（conversation.header.leading）。
         * ------------------------------------------------------------- */
        function EmAgentChip() {
          return h(
            'button',
            {
              type: 'button',
              className: 'dsh-em-agent-chip',
              title: '打开 EM Agent',
              onClick: () => modal.set(true),
            },
            h('span', { className: 'dsh-em-agent-chip-mark', 'aria-hidden': 'true' }),
            'EM Agent',
          );
        }

        ctx.slots.inject('conversation.header.leading', () =>
          ctx.slots.register({ name: 'conversation.header.leading' }, EmAgentChip),
        );

        /* ---------------------------------------------------------------
         * 4) 整页：main 面板，iframe 承载控制台；「开启 EM 仿真」的落点
         * ------------------------------------------------------------- */
        function EmAgentPage() {
          const pair = React.useState({ src: undefined });
          const panel = pair[0];
          const setPanel = pair[1];

          React.useEffect(() => {
            let alive = true;
            resolvePanelSrc().then((next) => {
              if (alive) setPanel(next);
            });
            return () => {
              alive = false;
            };
          }, []);

          const children = [
            h(
              'div',
              { key: 'bar', style: barStyle },
              h('strong', { key: 'title' }, 'DSH EM Agent'),
              h('span', { key: 'sub', style: subStyle }, '硬件设计控制台'),
              h(
                'button',
                {
                  key: 'back',
                  type: 'button',
                  title: '返回对话',
                  onClick: () => {
                    try {
                      ctx.layout.selectPanel(null);
                    } catch (e) {
                      /* 同上：不打断渲染 */
                    }
                  },
                  style: {
                    marginLeft: 'auto',
                    padding: '2px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--dsw-alias-border-l1, #d9dee6)',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                  },
                },
                '返回对话',
              ),
            ),
          ];

          if (panel && panel.src) {
            children.push(
              h('iframe', {
                key: 'frame',
                src: panel.src,
                title: 'DSH EM Agent 控制台',
                style: frameStyle,
              }),
            );
          } else {
            children.push(
              h(
                'div',
                { key: 'hint', style: { padding: '16px', lineHeight: '1.7' } },
                panel && panel.reason === 'unresolved'
                  ? '未能定位控制台路由：相对路径与宿主注入的 origin 都不可用。请确认插件已在当前 profile 中挂载，并刷新页面。'
                  : '正在加载控制台…',
              ),
            );
          }

          return h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
              },
            },
            children,
          );
        }

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, EmAgentPage),
        );
      },
    };
  },
});
