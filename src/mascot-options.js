// 桌宠（吉祥物）选项：纯数据，便于单测。
// 内置的猫 / 机器人 / 幽灵 / 星星 / Q版系列是自绘 SVG（无版权问题）；大肥鱼沿用项目原有 PNG。
// states 可以给不同状态配不同图片：running（计时中）/ celebrate（阶段完成）/ rest（休息）。
export const DEFAULT_MASCOT_ID = 'dafeiyu';

export const MASCOT_OPTIONS = [
  {
    id: 'dafeiyu',
    name: '大肥鱼',
    src: 'mascot/dafeiyu-cut.png',
    desc: 'DeepSeek 吉祥物',
  },
  {
    id: 'cat',
    name: '小猫',
    src: 'mascot/cat.svg',
    desc: '奶油橘猫',
    states: {
      idle: 'mascot/cat.svg',
      running: 'mascot/cat-run.svg',
      celebrate: 'mascot/cat-party.svg',
    },
  },
  {
    id: 'robot',
    name: '小机器人',
    src: 'mascot/robot.svg',
    desc: '会闪灯的机器人',
    states: {
      idle: 'mascot/robot.svg',
      running: 'mascot/robot-run.svg',
      celebrate: 'mascot/robot-party.svg',
    },
  },
  {
    id: 'ghost',
    name: '小幽灵',
    src: 'mascot/ghost.svg',
    desc: '夜光幽灵',
    states: {
      idle: 'mascot/ghost.svg',
      celebrate: 'mascot/ghost-party.svg',
    },
  },
  {
    id: 'star',
    name: '小星星',
    src: 'mascot/star.svg',
    desc: '会发光的小星星',
    states: {
      idle: 'mascot/star.svg',
      celebrate: 'mascot/star-party.svg',
    },
  },
  {
    id: 'q-whale',
    name: 'Q版小鲸鱼',
    src: 'mascot/q-whale.svg',
    desc: 'Q版 · 原创',
  },
  {
    id: 'q-robot',
    name: 'Q版小机器人',
    src: 'mascot/q-robot.svg',
    desc: 'Q版 · 原创',
  },
  {
    id: 'q-moon',
    name: 'Q版小月亮',
    src: 'mascot/q-moon.svg',
    desc: 'Q版 · 原创',
  },
  {
    id: 'q-cloud',
    name: 'Q版小云朵',
    src: 'mascot/q-cloud.svg',
    desc: 'Q版 · 原创',
  },
];

export function findMascot(id) {
  return MASCOT_OPTIONS.find((item) => item.id === id) || null;
}
