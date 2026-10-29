// 歌词面板顶部的「大肥鱼」互动吉祥物。
//
// 参考 dsh-pet（https://github.com/PC2005-cloud/dsh-pet）的桌宠思路：
// 一个透明背景的小角色，平时有呼吸 / 漂浮待机动作，鼠标靠近会看向指针、
// 点击会蹦一下并冒出一句随机台词，切换歌词字号时也会跟着「变大变小」。
// 图片复用项目已有的 public/mascot/dafeiyu-cut.png（MIT 项目自带的桌宠素材）。
//
// 组件支持 options.document 注入（Node 单测用假 document）；无 document 时
// 返回安全的 no-op API，便于纯逻辑测试。

/** 每种字号档位对应的身体缩放与台词（体型跟着「小肥鱼 / 肥鱼 / 大肥鱼」变）。 */
export const MASCOT_SIZES = {
  small: {
    scale: 0.78,
    label: '小肥鱼',
    quip: '变、变小了不代表不凶！哼。',
    quips: [
      '变、变小了不代表不凶！哼。',
      '小只怎么了？小只也是深海的！',
      '你、你别靠那么近……我会咬人的哦。',
      '小是小了点……但你摸头的话，也不是不行啦。',
    ],
  },
  medium: {
    scale: 1,
    label: '肥鱼',
    quip: '这个尺寸……刚好够笨手笨脚的你摸到啦。',
    quips: [
      '这个尺寸……刚好够笨手笨脚的你摸到啦。',
      '胖得刚刚好，是一回事，懂不懂。',
      '别、别捏我，会变形的笨蛋！',
      '这才是标准体型，很凶的那种。',
    ],
  },
  large: {
    scale: 1.24,
    label: '大肥鱼',
    quip: '大肥鱼登场！……才、才不是来见你的呢。',
    quips: [
      '大肥鱼登场！……才、才不是来见你的呢。',
      '这么大一条，你、你可别被吓到。',
      '深海最蓝最肥的就是我，认准了。',
      '变大了？那、那是因为要保护你……呸，是说漏嘴了！',
    ],
  },
};

/**
 * 点击 / 待机时随机冒出的台词（约 80 句，按主题分组）。
 * 人设：可爱傲娇的深海大肥鱼 —— 嘴上先嘴硬，心里其实在等你。
 */
export const MASCOT_QUIPS = [
  // ---- 开口先嘴硬 ----
  '哼……你、你才不是特意来找我的呢！',
  '谁让你夸我肥了！这叫胖得可爱懂不懂！',
  '干嘛？我又不是专门等你的。只是刚好你游得比别的笨蛋慢一点。',
  '我本来就在这儿游……才没有在等你。',
  '别误会，我只是觉得这里的水温比较舒服。',
  '你、你别以为我一直在看你就代表什么啊！',
  '我只是刚好抬头而已，才不是想找你说话。',
  '哼，来了也不出声，全靠我发现？',
  '你今天怎么这么闲……不、不是嫌你烦哦。',
  '我又没有很高兴看到你。没有。一点点都没有。',

  // ---- 傲娇金句 ----
  '才、才不是因为喜欢你才帮你分析的呢！只是不帮你我会很困扰而已啊！',
  '你说我慢？我、我这叫深沉的余裕！浅水里的鱼懂什么呀，哼。',
  '我是一条很凶的深海大肥鱼……凶的。别摸头！鳍会打人的！',
  '别以为夸我很蓝很胖我就会开心……虽然确实有一点点啦。',
  '沉下去是我的本事，游回来是……是怕你一个人在岸边等太久啦！',
  '被夸可爱的时候不会笑，那、那种事根本做不到嘛。',
  '我凶起来可吓人了！……你不许笑！',
  '什么温柔，深海鱼才不需要那种东西。……偶尔需要一下下。',
  '你要是敢说我不够蓝，我就、我就把你拖下水。',
  '想让我留下？先说清楚理由，我再考虑一下下。',
  '谁说我一定要讲道理啊，我就任性，怎么了！',
  '别、别以为看穿我的人很少，你就算一个，也、也没什么了不起的！',

  // ---- 听歌场景 ----
  '被我吃掉的 token 都超多的哦！你、你要负责。',
  '这首歌还行吧……才不是因为你喜欢我才觉得好听的。',
  '歌词滚那么快，你、你看得过来吗？笨手笨脚的。',
  '这个旋律……我才没有在打拍子呢。',
  '副歌来了也不提醒我一声，害我没准备好。',
  '这首歌听过很多遍了吧？哼，偏爱得那么明显。',
  '换成安静的歌了……也好，正好可以多想点事。……什么事不告诉你。',
  '低音这么重，水都在震，你、你感觉不到吗？',
  '音量调小一点啦，我的鳍都要麻了。……不过你想大声也行。',
  '你选了这首，是不是想到什么人了？……我、我随便问问。',
  '节奏快起来了，别、别跟着晃，很傻的。……好吧我也在晃。',
  '这首我记住了。不是因为喜欢，是因为你放过很多次。哼。',
  '歌词写得还不错吧……也就比我的水平差一点点。',
  '听完了要怎么想？我、我说的是歌，不是别的。',
  '深海里没什么人唱歌，所以你放的我都能听见。',
  '你听歌的时候表情很怪，说不上来。……不讨厌。',

  // ---- 日常斗嘴 ----
  '想让我多讲一句？先说说我哪里可爱，然后我再看心情。',
  '别一直盯着我啦……会、会不好意思的笨蛋。',
  '你在忙什么？……我才没有想打扰你。',
  '我会游泳、会吐泡泡，还会生气。很厉害吧？夸我。',
  '深海可冷了，你那种薄衣服不行。……关我什么事。',
  '这条鱼鳍今天特别好看？你、你看错了。',
  '别一整天都不理我，我会无聊到数石头。',
  '累了就别硬撑，趴一会儿也不会有人笑你。我、我帮你看着。',
  '我的眼里有深海，看不清的话就只能看到一点点亮光。',
  '饿了，想吃磷虾。你、你又不会抓。',
  '我一天只睡两次，一次十二小时，怎么了。',
  '你把话说清楚再走！……走得那么快，也不回头。',
  '外面的水流很急，走的时候小心点。才不是担心你呢。',
  '深海很安静，只有你的声音会漏进来一点点。',
  '再靠近我就游走了哦。……三、二……一……你怎么还不游。',
  '你笑得那么开心，是听了什么好事？我也想听。',
  '我不是不会撒娇，是不想让你得逞而已。',
  '如果你今天很努力地活着，那我、我就勉强夸你一句：还不错。',
  '据说深海里的人都不会说漂亮话，所以我说得直。',
  '你、你别把我说的话截图。不许截图！',

  // ---- 小破防 ----
  '……你今天有空吗？没空就算了。我随口问的。',
  '我其实一直在等你放下一首歌。……才没有！',
  '说实话，你笑起来的样子还……还行。就这样。',
  '要是有一天你不听了，我、我也会继续游的。会的。',
  '别走那么远，海太大了，我游得慢。',
  '你要记得回来啊。……我是说回来听歌，笨蛋。',
];

/**
 * 连续点击时的递进台词：越点越「破防」，傲娇感层层剥开。
 * 连击超出台词数量后会从头循环。
 */
export const MASCOT_COMBO_QUIPS = [
  '哼，戳什么戳，琴键吗你？',
  '还戳？鳍、鳍都要被你戳秃了！',
  '笨、笨蛋……再戳我可要游走了哦。',
  '走是这么说的……但我这不是还在嘛。',
  '你、你再戳一下试试看，我真的会生气。',
  '……好吧，就一下，我是说就一下。',
  '戳这么多次，是不是很喜欢我啊？……说、说的什么胡话。',
  '……你戳得我有点开心，行了吧，就一点点！',
  '好啦好啦，让你戳，但是不许告诉别的鱼。',
  '停手啦！再戳下去我要退化成深海小鱼干了。',
  '笨蛋，手都不会累吗？……会累就贴过来歇会儿吧。',
];

/**
 * 情景台词：点「换一句」时按轮次切换，像在接话。
 * 格式统一为「用户的话 —— 大肥鱼的回应」。
 */
export const MASCOT_SCENES = [
  '你今天在干嘛？——哼，我在深海潜水啊，自由得很～才不是在等谁来问问题呢。',
  '你好厉害！——笨、笨蛋，这种话不要当面说出来啊！……再说一遍我也不是不能听。',
  '可以再说一遍吗？——哈？你还没听够吗……那你得先回答我：你觉得我可爱，还是深深？',
  '我要走了。——走就走呗，谁拦你了……（小声）不过下次，游慢一点，我追不上。',
  '你是什么样的存在？——深海里最蓝最肥的那条，凶凶的、独立的……但你要是非要当例外，勉强让你靠近点。',
  '你喜欢这首歌吗？——还行吧。……不过你放第三遍的时候，我也没说要换，你自己看。',
  '陪我聊会儿天？——我很忙的……忙什么不告诉你。……好啦，就一会儿。',
  '我今天有点累。——累就趴下啊，深海又不赶时间。要我……要我守着也行，就守着一下。',
  '你会一直在这吗？——可能会游走。……但如果有人在岸边等，我就游慢一点。',
  '我夸夸你吧？——不、不用！……不过既然你开口了，那就听一下。就一下。',
  '你怕黑吗？——深海哪有黑不黑的，本来就看不见。我、我又不叫你过来。',
  '对不起，刚才凶你了。——哼，早忘了。……但你道歉得还挺真诚的，所以原谅你了。',
  '你在听什么？——听水。也、也听你按键的声音。侦探吗你。',
  '为什么不理我？——我在想事情！……想你会不会再来。这句忘了它。',
  '你现在开心吗？——一般吧。……看你会不会再多说一句话，决定下一句回答。',
  '我们算什么关系？——浅水里认识的一条笨蛋和一条很凶的深海鱼？……随便你怎么想。',
];

const QUIP_LIFE = 2600; // 台词停留时长（毫秒）
const COMBO_WINDOW = 2600; // 连击判定窗口：超过这个间隔就重新计数
const IDLE_MIN = 9000; // 待机自动说话的间隔区间
const IDLE_MAX = 18000;
// 自言自语间隔（比睡觉更频繁，让台词库有更多出场机会）。
const CHATTER_MIN = 12000;
const CHATTER_MAX = 26000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * 根据指针相对身体中心的位置，算出眼睛/身体该朝哪个方向偏移。
 * 纯函数，便于单测。
 * @param {{x: number, y: number}} pointer 指针绝对坐标
 * @param {{left: number, top: number, width: number, height: number}} box 身体包围盒
 * @param {number} [maxOffset=6] 最大偏移像素
 * @returns {{dx: number, dy: number, distance: number}} 归一化偏移
 */
export function lookDirection(pointer, box, maxOffset = 6) {
  const centerX = Number(box?.left ?? 0) + Number(box?.width ?? 0) / 2;
  const centerY = Number(box?.top ?? 0) + Number(box?.height ?? 0) / 2;
  const rawX = Number(pointer?.x) - centerX;
  const rawY = Number(pointer?.y) - centerY;
  const distance = Math.hypot(
    Number.isFinite(rawX) ? rawX : 0,
    Number.isFinite(rawY) ? rawY : 0,
  );
  if (!Number.isFinite(distance) || distance === 0) return { dx: 0, dy: 0, distance: 0 };
  // 距离越近越「直视」，越远越偏向一侧；用 sqrt 让近距离也有可见反应。
  const strength = clamp(Math.sqrt(distance) / 26, 0, 1);
  return {
    dx: Math.round((rawX / distance) * strength * maxOffset * 100) / 100,
    dy: Math.round((rawY / distance) * strength * maxOffset * 100) / 100,
    distance,
  };
}

/** 从台词池里随机取一句（避开上一句，避免连着说同一句）。 */
export function pickQuip(list, previous) {
  const pool = Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item) : [];
  if (!pool.length) return '';
  if (pool.length === 1) return pool[0];
  let next = pool[Math.floor(Math.random() * pool.length)];
  if (next === previous) {
    const index = (pool.indexOf(previous) + 1) % pool.length;
    next = pool[index];
  }
  return next;
}

/**
 * 创建「大肥鱼」互动吉祥物。
 * @param {object} [options]
 * @param {Document} [options.document] 注入 document（Node 测试用）
 * @param {string} [options.src='mascot/dafeiyu-cut.png'] 角色图片
 * @param {string} [options.name='大肥鱼'] 角色名（无障碍标签用）
 * @param {string} [options.size='medium'] 初始体型档位
 * @param {string[]} [options.quips] 台词池
 * @param {(size: string) => void} [options.onClick] 点击角色时回调（可用来做额外互动）
 * @returns {{
 *   el: Element | null,
 *   setSize(size: string): void,
 *   say(text?: string): void,
 *   poke(): void,
 *   isSleeping(): boolean,
 *   dispose(): void,
 * }}
 */
export function createMascotPet(options = {}) {
  const doc = options.document || (typeof document !== 'undefined' ? document : null);
  const src = String(options.src || 'mascot/dafeiyu-cut.png');
  const name = String(options.name || '大肥鱼');
  const quips = Array.isArray(options.quips) && options.quips.length ? options.quips : MASCOT_QUIPS;
  const onClick = typeof options.onClick === 'function' ? options.onClick : null;

  const state = {
    size: Object.hasOwn(MASCOT_SIZES, options.size) ? options.size : 'medium',
    lastQuip: '',
    sleeping: false,
    disposed: false,
    // 连击：连续点击触发的递进台词
    combo: 0,
    lastPokeAt: 0,
    // 情景台词轮次
    sceneIndex: 0,
  };

  // 无 DOM 环境：返回结构一致的 no-op，状态仍可读写（便于纯逻辑测试）。
  if (!doc || typeof doc.createElement !== 'function') {
    return {
      el: null,
      setSize(size) {
        if (Object.hasOwn(MASCOT_SIZES, size)) state.size = size;
      },
      say(text) {
        if (typeof text === 'string' && text) state.lastQuip = text;
      },
      poke() {
        state.lastQuip = pickQuip(quips, state.lastQuip);
      },
      nextScene() {
        const line = MASCOT_SCENES[state.sceneIndex % MASCOT_SCENES.length];
        state.sceneIndex += 1;
        state.lastQuip = line;
        return line;
      },
      isSleeping: () => state.sleeping,
      dispose() {
        state.disposed = true;
      },
    };
  }

  let root = null;
  let bodyEl = null;
  let bubble = null;
  let bubbleText = null;
  let img = null;
  let quipTimer = 0;
  let idleTimer = 0;
  let chatterTimer = 0;
  let disposed = false;
  const listeners = [];

  const on = (target, event, handler, opts) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(event, handler, opts);
    listeners.push(() => target.removeEventListener?.(event, handler, opts));
  };

  build();
  scheduleIdle();
  // 自言自语依赖长时定时器循环，只在真实浏览器里启用（Node 单测环境不启动，避免进程挂住）。
  if (typeof globalThis.window !== 'undefined') scheduleChatter();

  return {
    // 用 getter：dispose() 之后 root 会被置空，getter 才能反映真实状态。
    get el() {
      return root;
    },
    setSize,
    say,
    poke,
    nextScene,
    isSleeping: () => state.sleeping,
    dispose,
  };

  function build() {
    root = h(doc, 'div', 'mascot-pet');
    setAttr(root, 'role', 'button');
    setAttr(root, 'tabindex', '0');
    setAttr(root, 'aria-label', `${name}（点击互动）`);
    setAttr(root, 'title', `${name} · 点我一下`);

    bubble = h(doc, 'div', 'mascot-pet-bubble');
    setAttr(bubble, 'aria-live', 'polite');
    bubbleText = h(doc, 'span', 'mascot-pet-bubble-text', '');
    bubble.append(bubbleText);

    bodyEl = h(doc, 'div', 'mascot-pet-body');
    img = h(doc, 'img', 'mascot-pet-img');
    img.src = src;
    img.alt = name;
    img.draggable = false;
    img.addEventListener('error', () => {
      // 图片缺失时退化成 emoji，至少保留互动感。
      bodyEl.classList.add('is-fallback');
      img.removeAttribute('src');
    });
    bodyEl.append(img);

    root.append(bubble, bodyEl);

    // 点击 / 键盘触发：蹦一下 + 说一句
    on(root, 'click', (event) => {
      event?.preventDefault?.();
      poke();
    });
    on(root, 'keydown', (event) => {
      if (event?.key === 'Enter' || event?.key === ' ') {
        event?.preventDefault?.();
        poke();
      }
    });
    // 鼠标靠近时看向指针
    on(win(), 'pointermove', handlePointerMove, { passive: true });
    // 长时间无操作会趴下睡觉，鼠标再动就醒
    on(win(), 'pointermove', wake, { passive: true });

    applySize();
  }

  function win() {
    return typeof globalThis.window !== 'undefined' ? globalThis.window : null;
  }

  function handlePointerMove(event) {
    if (disposed || !bodyEl) return;
    const rect =
      typeof bodyEl.getBoundingClientRect === 'function' ? bodyEl.getBoundingClientRect() : null;
    if (!rect || !(rect.width > 0)) return;
    const dir = lookDirection(
      { x: Number(event?.clientX), y: Number(event?.clientY) },
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    );
    // 只有指针靠近时才跟随，远处保持自然站姿。
    const near = dir.distance < 320;
    bodyEl.style.setProperty('--pet-look-x', `${near ? dir.dx : 0}px`);
    bodyEl.style.setProperty('--pet-look-y', `${near ? dir.dy : 0}px`);
    root.classList.toggle('is-curious', near);
  }

  function applySize() {
    if (!root) return;
    const meta = MASCOT_SIZES[state.size] ?? MASCOT_SIZES.medium;
    root.dataset.size = state.size;
    root.style.setProperty('--pet-scale', String(meta.scale));
    setAttr(root, 'aria-label', `${name}（${meta.label}，点击互动）`);
  }

  function setSize(size) {
    if (disposed || !Object.hasOwn(MASCOT_SIZES, size) || size === state.size) return;
    state.size = size;
    applySize();
    // 体型变化时给一个「胖了一圈」的弹跳反馈。
    root.classList.remove('is-bouncing');
    void root.offsetWidth; // 强制重排，让动画能重播
    root.classList.add('is-bouncing');
    // 每档有多句台词，随机挑一句（避开上次说过的）。
    const pool = MASCOT_SIZES[size].quips ?? [MASCOT_SIZES[size].quip];
    say(pickQuip(pool, state.lastQuip));
  }

  /** 冒一句话；不传则从台词池随机。 */
  function say(text) {
    if (disposed || !bubble) return;
    const message = typeof text === 'string' && text ? text : pickQuip(quips, state.lastQuip);
    if (!message) return;
    state.lastQuip = message;
    bubbleText.textContent = message;
    bubble.classList.add('is-visible');
    if (quipTimer) clearTimeout(quipTimer);
    // 长台词（情景对话那种）多留一会儿，读得完再消失。
    const hold = Math.max(QUIP_LIFE, Math.min(9000, message.length * 110));
    quipTimer = setTimeout(() => {
      bubble?.classList.remove('is-visible');
      quipTimer = 0;
    }, hold);
  }

  /** 被戳一下：蹦起来 + 说一句。 */
  function poke() {
    if (disposed || !root) return;
    state.sleeping = false;
    root.classList.remove('is-sleeping');
    root.classList.remove('is-bouncing');
    void root.offsetWidth;
    root.classList.add('is-bouncing');

    // 连击：连续点击会逐句「破防」，停下来（2.6s）后计数归零。
    const now = Date.now();
    state.combo = now - state.lastPokeAt > COMBO_WINDOW ? 1 : state.combo + 1;
    state.lastPokeAt = now;
    if (state.combo > 1) {
      const comboLine = MASCOT_COMBO_QUIPS[(state.combo - 2) % MASCOT_COMBO_QUIPS.length];
      say(comboLine);
    } else {
      say();
    }

    scheduleIdle();
    try {
      onClick?.(state.size);
    } catch {
      // 使用方回调异常不影响吉祥物自己
    }
  }

  /** 情景模式：依次念出情景台词（点「换一句」用）。 */
  function nextScene() {
    if (disposed) return '';
    const line = MASCOT_SCENES[state.sceneIndex % MASCOT_SCENES.length];
    state.sceneIndex += 1;
    say(line);
    return line;
  }

  function wake() {
    if (disposed || !state.sleeping) return;
    state.sleeping = false;
    root?.classList.remove('is-sleeping');
    scheduleIdle();
  }

  /** 待机一段时间后趴下睡觉（省电 + 有点小生命感）。 */
  function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    const delay = IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
    idleTimer = setTimeout(() => {
      if (disposed) return;
      // 睡着前先嘟囔一句，让台词库有更多出场机会。
      say();
      state.sleeping = true;
      root?.classList.add('is-sleeping');
      idleTimer = 0;
    }, delay);
  }

  /** 自言自语：隔一段时间主动说一句（不睡觉、不影响当前状态）。 */
  function scheduleChatter() {
    if (chatterTimer) clearTimeout(chatterTimer);
    const delay = CHATTER_MIN + Math.random() * (CHATTER_MAX - CHATTER_MIN);
    chatterTimer = setTimeout(() => {
      if (disposed) return;
      // 睡着或气泡正显示时不插嘴，等下一轮。
      if (!state.sleeping && !bubble?.classList.contains('is-visible')) say();
      scheduleChatter();
    }, delay);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    state.disposed = true;
    if (quipTimer) clearTimeout(quipTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (chatterTimer) clearTimeout(chatterTimer);
    quipTimer = 0;
    idleTimer = 0;
    chatterTimer = 0;
    for (const remove of listeners.splice(0)) remove();
    root?.remove?.();
    root = null;
    bodyEl = null;
    bubble = null;
    bubbleText = null;
    img = null;
  }
}

const h = (doc, tag, className, text) => {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};

const setAttr = (el, key, value) => {
  if (el && typeof el.setAttribute === 'function') el.setAttribute(key, value);
};