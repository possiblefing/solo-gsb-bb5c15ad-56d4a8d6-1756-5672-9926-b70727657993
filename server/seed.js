'use strict';

/**
 * 首次启动时写入的示例剧情。
 *
 * 《迷雾古堡》刻意覆盖全部问题类型：
 *   - 循环：庭院 ↔ 大门、大厅 ↔ 高塔，依靠 (场景, 变量快照) 去重终止
 *   - 不可达：secret_room（孤岛）、throne（最近可达路径上条件不成立）
 *   - 死选项：courtyard / garden 中条件 knows_password 恒为 false（全剧无人赋值）
 *   - 阻断跳转：无火把进书房、无火把进地窖
 */

const castle = {
  format: 'branching-story/v1',
  name: '示例：迷雾古堡（含全部问题类型）',
  startScene: 'entrance',
  variables: [
    { name: 'has_torch', initial: false },
    { name: 'has_key', initial: false },
    { name: 'gate_open', initial: false },
    { name: 'knows_password', initial: false }
  ],
  scenes: [
    {
      id: 'entrance',
      title: '古堡大门',
      text: '藤蔓缠绕的铁门半掩着，墙上挂着一支熄灭的火把，西侧有一扇侧门。',
      precondition: '',
      options: [
        { label: '推门进入庭院', condition: '', assignments: [], target: 'courtyard' },
        { label: '摸黑走进侧厅（书房）', condition: '', assignments: [], target: 'library' },
        { label: '点燃墙上的火把', condition: '!has_torch', assignments: [{ variable: 'has_torch', value: true }], target: 'courtyard' }
      ]
    },
    {
      id: 'courtyard',
      title: '荒草庭院',
      text: '庭院中央是干涸的喷泉，北侧一扇紧锁的铁门，东侧通向花园。',
      precondition: '',
      options: [
        { label: '走回大门', condition: '', assignments: [], target: 'entrance' },
        { label: '进入东侧花园', condition: '', assignments: [], target: 'garden' },
        { label: '用钥匙打开铁门', condition: 'has_key', assignments: [], target: 'gate' },
        { label: '念咒语打开铁门', condition: 'knows_password', assignments: [], target: 'gate' }
      ]
    },
    {
      id: 'garden',
      title: '枯萎花园',
      text: '灌木疯长，喷泉旁的石板似乎松动过。',
      precondition: '',
      options: [
        { label: '搜查灌木丛', condition: '!has_key', assignments: [{ variable: 'has_key', value: true }], target: 'courtyard' },
        { label: '返回庭院', condition: '', assignments: [], target: 'courtyard' },
        { label: '对着喷泉念出密语', condition: 'knows_password', assignments: [], target: 'throne' }
      ]
    },
    {
      id: 'gate',
      title: '铁门之后',
      text: '钥匙转动，铁门发出沉闷的声响，门后是漆黑的大厅。',
      precondition: 'has_key',
      options: [
        { label: '推门进入大厅', condition: '', assignments: [{ variable: 'gate_open', value: true }], target: 'hall' },
        { label: '退回庭院', condition: '', assignments: [], target: 'courtyard' }
      ]
    },
    {
      id: 'hall',
      title: '尘封大厅',
      text: '大厅一侧是盘旋向上的高塔楼梯，另一侧是通往地窖的石阶。',
      precondition: 'gate_open',
      options: [
        { label: '登上高塔', condition: '', assignments: [], target: 'tower' },
        { label: '举火把走下地窖', condition: '', assignments: [], target: 'cellar' },
        { label: '退回铁门', condition: '', assignments: [], target: 'gate' }
      ]
    },
    {
      id: 'tower',
      title: '风雨高塔',
      text: '塔顶只有呼啸的风和破碎的窗棂。',
      precondition: '',
      options: [{ label: '沿旋梯返回大厅', condition: '', assignments: [], target: 'hall' }]
    },
    {
      id: 'cellar',
      title: '潮湿地窖',
      text: '火光照亮了角落里的一个黄铜宝箱。',
      precondition: 'has_torch',
      options: [{ label: '打开黄铜宝箱', condition: '', assignments: [], target: 'treasure' }]
    },
    {
      id: 'treasure',
      title: '宝库',
      text: '宝箱中是一枚沉睡百年的家族徽章。【结局：寻回徽章】',
      precondition: '',
      options: []
    },
    {
      id: 'library',
      title: '侧厅书房',
      text: '书架倾倒，霉味刺鼻，需要火把才能看清道路。',
      precondition: 'has_torch',
      options: [
        { label: '翻阅古书（一无所获）', condition: '', assignments: [], target: 'library' },
        { label: '沿侧廊回到大门', condition: '', assignments: [], target: 'entrance' }
      ]
    },
    {
      id: 'secret_room',
      title: '镜后密室',
      text: '没有人知道如何来到这里。',
      precondition: 'knows_password',
      options: []
    },
    {
      id: 'throne',
      title: '废弃王座厅',
      text: '尘封的王座上搭着褪色的王旗。',
      precondition: '',
      options: [{ label: '返回花园', condition: '', assignments: [], target: 'garden' }]
    }
  ]
};

const village = {
  format: 'branching-story/v1',
  name: '示例：双结局小村（无问题对照）',
  startScene: 'village',
  variables: [{ name: 'helped_smith', initial: false }],
  scenes: [
    {
      id: 'village',
      title: '村口',
      text: '铁匠正在村口发愁，他的锤子掉进了河里。',
      precondition: '',
      options: [
        { label: '帮铁匠捞起锤子', condition: '!helped_smith', assignments: [{ variable: 'helped_smith', value: true }], target: 'forest' },
        { label: '不帮忙，直接进森林', condition: '', assignments: [], target: 'forest' }
      ]
    },
    {
      id: 'forest',
      title: '迷雾森林',
      text: '巨龙盘踞在北路，南路则是回家的小径。',
      precondition: '',
      options: [
        { label: '持铁匠打造的剑讨伐巨龙', condition: 'helped_smith', assignments: [], target: 'dragon_ending' },
        { label: '沿南路回家', condition: '', assignments: [], target: 'home_ending' }
      ]
    },
    {
      id: 'dragon_ending',
      title: '屠龙者',
      text: '你举起长剑，晨光洒在森林的小径上。【结局：英雄】',
      precondition: '',
      options: []
    },
    {
      id: 'home_ending',
      title: '平凡的归途',
      text: '你平安回到了家中，炉火正旺。【结局：归家】',
      precondition: '',
      options: []
    }
  ]
};

module.exports = [castle, village];
