// 顶部导航栏：半透明毛玻璃，与深紫主题一致。默认不自动挂载（由 Lead 决定是否常驻）。
// 提供两种视觉形态：pill 横排（带文字）/ icon 图标居中（类切换即可）。
// items 形如 [{ id, label, icon(可选 SVG 字符串), badge(可选 数字/字符串) }]
export const NAV_VARIANTS = ['pill', 'icon'];

export function createNavbar(options = {}) {
  const {
    document: doc = (typeof globalThis !== 'undefined' && globalThis.document) || null,
    items: initialItems = [],
    activeId = null,
    variant = 'pill',
    visible = true,
    onSelect = null,
  } = options;

  const items = [];
  if (Array.isArray(initialItems)) {
    for (const item of initialItems) {
      if (item && typeof item.id === 'string') items.push({ ...item });
    }
  }

  let current = activeId && items.some(i => i.id === activeId) ? activeId : null;
  let variantName = NAV_VARIANTS.includes(variant) ? variant : 'pill';
  let callback = typeof onSelect === 'function' ? onSelect : null;
  let itemVisible = visible === true;
  let disposed = false;
  let rootNode = null;
  let listEl = null;

  function applyVariant() {
    if (!rootNode || !rootNode.classList) return;
    rootNode.classList.remove('navbar-variant-pill', 'navbar-variant-icon');
    rootNode.classList.add(`navbar-variant-${variantName}`);
  }

  function buildList() {
    if (!rootNode || !listEl) return;
    while (listEl.children && listEl.children.length) listEl.removeChild(listEl.children[0]);
    for (const item of items) {
      const btn = doc.createElement('button');
      btn.className = 'navbar-item';
      if (item.id === current) btn.classList.add('navbar-active');
      btn.setAttribute('data-id', item.id);
      btn.setAttribute('type', 'button');

      if (item.icon) {
        const icon = doc.createElement('span');
        icon.className = 'navbar-icon';
        icon.innerHTML = item.icon;
        btn.appendChild(icon);
      }
      if (item.label) {
        const label = doc.createElement('span');
        label.className = 'navbar-label';
        label.textContent = item.label;
        btn.appendChild(label);
      }
      if (item.badge != null && item.badge !== '') {
        const badge = doc.createElement('span');
        badge.className = 'navbar-badge';
        badge.textContent = String(item.badge);
        btn.appendChild(badge);
      }
      if (btn.addEventListener) {
        btn.addEventListener('click', () => select(item.id));
      }
      listEl.appendChild(btn);
    }
  }

  // 选中某一项：更新高亮并触发回调（点击或程序调用共用此路径）。
  function select(id) {
    if (disposed) return api;
    if (!items.some(i => i.id === id)) return api;
    current = id;
    if (listEl && listEl.children) {
      for (const btn of listEl.children) {
        btn.classList.toggle('navbar-active', btn.getAttribute('data-id') === id);
      }
    }
    if (callback) {
      try {
        callback(id);
      } catch (_e) {}
    }
    return api;
  }

  function setItems(nextItems) {
    if (disposed) return api;
    items.length = 0;
    if (Array.isArray(nextItems)) {
      for (const item of nextItems) {
        if (item && typeof item.id === 'string') items.push({ ...item });
      }
    }
    if (current && !items.some(i => i.id === current)) current = null;
    if (rootNode) buildList();
    return api;
  }

  function setVariant(name) {
    if (NAV_VARIANTS.includes(name)) {
      variantName = name;
      applyVariant();
    }
    return api;
  }

  function setVisible(value) {
    itemVisible = value === true;
    if (rootNode && rootNode.classList) {
      rootNode.classList.toggle('navbar-hidden', !itemVisible);
    }
    return api;
  }

  function show() {
    return setVisible(true);
  }

  function hide() {
    return setVisible(false);
  }

  // 兼容两种用法：onClick(fn) 注册回调；onClick(name) 程序化触发某一项。
  function onClick(nameOrFn) {
    if (typeof nameOrFn === 'function') {
      callback = nameOrFn;
      return api;
    }
    if (typeof nameOrFn === 'string') return select(nameOrFn);
    return api;
  }

  function getActive() {
    return current;
  }

  function getItems() {
    return items.map(i => ({ ...i }));
  }

  function attach(hostEl) {
    if (disposed || !doc || typeof doc.createElement !== 'function') return api;
    const target = hostEl || doc.body || doc.documentElement;
    if (!target) return api;
    if (!rootNode) {
      rootNode = doc.createElement('nav');
      rootNode.className = 'navbar';
      rootNode.setAttribute('aria-label', '主导航');
      listEl = doc.createElement('div');
      listEl.className = 'navbar-inner';
      rootNode.appendChild(listEl);
      if (rootNode.addEventListener) {
        // 事件委托：点击任何 .navbar-item 都走 select
        rootNode.addEventListener('click', event => {
          const targetEl = event.target;
          if (!targetEl) return;
          const btn =
            (targetEl.closest && targetEl.closest('.navbar-item')) ||
            (targetEl.getAttribute && targetEl.getAttribute('data-id') ? targetEl : null);
          if (btn) select(btn.getAttribute('data-id'));
        });
      }
      buildList();
    }
    applyVariant();
    target.appendChild(rootNode);
    setVisible(itemVisible);
    return api;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (rootNode && rootNode.parentNode && rootNode.parentNode.removeChild) {
      try {
        rootNode.parentNode.removeChild(rootNode);
      } catch (_e) {}
    }
    rootNode = null;
    listEl = null;
  }

  const api = {
    setItems,
    setVariant,
    show,
    hide,
    setVisible,
    onClick,
    getActive,
    getItems,
    attach,
    dispose,
  };
  Object.defineProperty(api, 'active', {
    get: () => current,
    set: name => {
      select(name);
    },
    enumerable: true,
  });
  Object.defineProperty(api, 'onSelect', {
    get: () => callback,
    set: fn => {
      callback = typeof fn === 'function' ? fn : null;
    },
    enumerable: true,
  });
  return api;
}