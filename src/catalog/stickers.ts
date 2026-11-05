import { DEFAULT_STYLE } from '../types';
import type { StickerPreset } from './types';
import { paintedStickerGeometry } from './sticker-geometry';
import { candyArt } from './sticker-art';
import { coloredStickerArt } from './sticker-paint';

type Family = { id: string; names: [string, string, string, string]; tags: string[] };
type Theme = { name: string; colors: [string, string, string]; families: Family[] };
const family = (id: string, names: Family['names'], ...tags: string[]): Family => ({ id, names, tags });
const themes: Theme[] = [
  { name: '星光天体', colors: ['#ffe09b', '#ffc267', '#8c6535'], families: [
    family('starburst', ['空心五角星', '八芒放射星', '星环六芒星', '星尾流光'], '星星', '闪光', '宇宙'),
    family('moon-phase', ['月牙伴星', '月面环形山', '垂星月牙', '双月相逢'], '月亮', '夜空'),
    family('planet', ['行星环带', '卫星环绕', '陨坑行星', '通讯小行星'], '星球', '太空'),
    family('comet', ['圆核彗星', '星核彗星', '心核彗星', '晶核彗星'], '流星', '速度'),
    family('constellation', ['山峰星座', '环湾星座', '跳跃星座', '六点星图'], '连星', '星图'),
  ] },
  { name: '心意信物', colors: ['#ffc1d0', '#f68ea9', '#96556a'], families: [
    family('heart-token', ['镂空爱心', '相依双心', '心动放射', '拼合碎心'], '爱心', '告白'),
    family('love-letter', ['心封来信', '拆封情书', '飞翼情书', '星封回信'], '信封', '通信'),
    family('heart-lock', ['心形小锁', '打开的心锁', '闪亮心锁', '锁与小钥匙'], '锁', '约定'),
    family('wing-heart', ['羽翼心愿', '光环天使心', '星冠翼心', '缎带守护心'], '翅膀', '祝福'),
    family('heart-balloon', ['单心气球', '双心气球', '三心气球束', '四心气球束'], '气球', '庆祝'),
  ] },
  { name: '缎带蕾丝', colors: ['#e4c5f2', '#c8a0e1', '#76548e'], families: [
    family('classic-bow', ['短翼蝴蝶结', '长尾蝴蝶结', '叠翼星扣结', '心扣飘带结'], '蝴蝶结', '丝带'),
    family('award-rosette', ['星章双飘带', '爱心奖花', '放射花章', '八瓣心奖章'], '勋章', '奖章'),
    family('ribbon-knot', ['交叠绸结', '左飘长绸结', '右卷长绸结', '心坠双绸结'], '绸带', '结饰'),
    family('lace-medallion', ['六环花蕾丝', '八环花蕾丝', '十环心蕾丝', '十二环心蕾丝'], '蕾丝', '花边'),
    family('hair-ornament', ['丝结发箍', '花叶发箍', '群星发箍', '双心发箍'], '发饰', '头饰'),
  ] },
  { name: '花叶庭园', colors: ['#c6e8c5', '#9ed2b1', '#527e62'], families: [
    family('garden-flower', ['四瓣单叶花', '六瓣双叶花', '八瓣双叶花', '十瓣花蕊花'], '花朵', '绿植'),
    family('tulip', ['单叶郁金香', '舒叶郁金香', '并生郁金香', '束带三瓣花'], '郁金香', '春天'),
    family('leaf-sprig', ['三叶细枝', '四叶细枝', '五叶细枝', '莓果六叶枝'], '枝叶', '植物'),
    family('clover', ['三叶幸运草', '四叶幸运草', '星环三叶草', '星环四叶草'], '幸运草', '幸运'),
    family('wreath', ['缎结叶环', '爱心叶环', '星心叶环', '双花繁叶环'], '花环', '边饰'),
  ] },
  { name: '甜点烘焙', colors: ['#ffd4b0', '#ffb88e', '#976c4f'], families: [
    family('layer-cake', ['心顶奶油蛋糕', '烛火生日蛋糕', '双层樱桃蛋糕', '三莓奶油蛋糕'], '蛋糕', '甜品'),
    family('ice-cream', ['单球甜筒', '双球甜筒', '旋顶冰淇淋', '双味星星甜筒'], '冰淇淋', '夏天'),
    family('donut', ['糖珠甜甜圈', '糖针甜甜圈', '星糖甜甜圈', '椭圆糖霜圈'], '甜甜圈', '甜食'),
    family('cookie', ['花边曲奇', '爱心曲奇', '星形曲奇', '四格华夫饼'], '饼干', '烘焙'),
    family('pudding', ['樱桃布丁', '缎结布丁', '心印奶霜布丁', '微笑焦糖布丁'], '布丁', '焦糖'),
  ] },
  { name: '茶饮汽水', colors: ['#c7e9e8', '#a5d9db', '#4f7f86'], families: [
    family('tea-cup', ['热气小茶杯', '双缕热茶杯', '嫩叶心茶杯', '微笑星茶杯'], '茶杯', '热饮'),
    family('boba', ['四珠奶茶', '心印六珠奶茶', '气泡八珠奶茶', '薄荷十珠奶茶'], '奶茶', '珍珠'),
    family('soda-glass', ['柠檬冰汽水', '薄荷冰汽水', '心莓冰汽水', '冒泡双冰汽水'], '汽水', '冷饮'),
    family('tea-pot', ['圆腹小茶壶', '方腹脚座茶壶', '花印小茶壶', '心印叶伴茶壶'], '茶壶', '下午茶'),
    family('bottle', ['叶印圆肩瓶', '心印细肩瓶', '星印方肩瓶', '圆窗宽身瓶'], '瓶子', '饮品'),
  ] },
  { name: '软萌动物', colors: ['#f5d8b8', '#e9bb92', '#89694e'], families: [
    family('cat-face', ['睁眼小猫', '额纹笑猫', '蝴蝶结心眼猫', '胡须眨眼猫'], '猫咪', '表情'),
    family('bunny-face', ['直耳小兔', '花簪笑兔', '领结心眼兔', '折耳眨眼兔'], '兔子', '表情'),
    family('bear-face', ['吻圈小熊', '星顶笑熊', '抱心小熊', '耳结眨眼熊'], '熊', '表情'),
    family('fox-face', ['尖耳小狐', '叶顶笑狐', '领结心眼狐', '双星眨眼狐'], '狐狸', '表情'),
    family('paw-print', ['三趾小肉垫', '四趾小肉垫', '心印四趾爪', '圆环四趾爪'], '爪印', '肉垫'),
  ] },
  { name: '表情伙伴', colors: ['#ffe4a8', '#ffd078', '#9a773d'], families: [
    family('smile-token', ['圆脸笑章', '齿边笑章', '爱心惊喜章', '圆角眨眼章'], '表情', '笑脸'),
    family('cloud-face', ['星伴晴云', '笑脸雨云', '爱心雨云', '眨眼雷云'], '云朵', '伙伴'),
    family('blob-face', ['软团小精灵', '水滴小精灵', '花团小精灵', '双脚小精灵'], '团子', '萌物'),
    family('robot-face', ['齿嘴小机器人', '星天线机器人', '心眼机器人', '底座眨眼机器人'], '机器人', '科技'),
    family('tiny-mascot', ['芽耳小伙伴', '蛋形小伙伴', '枝耳小伙伴', '花边小伙伴'], '精灵', '可爱'),
  ] },
  { name: '万圣奇遇', colors: ['#ffc38e', '#ed9d72', '#84607c'], families: [
    family('pumpkin', ['锯齿南瓜灯', '叶帽笑南瓜', '尖帽心眼南瓜', '双伴眨眼南瓜'], '南瓜', '万圣节'),
    family('little-ghost', ['波脚小幽灵', '飘尾恋爱幽灵', '领结招手幽灵', '双星软脚幽灵'], '幽灵', '万圣节'),
    family('witch-hat', ['弯尖巫师帽', '星印巫师帽', '叶果巫师帽', '月印丝结帽'], '巫师帽', '魔法'),
    family('spooky-bat', ['圆眼小蝙蝠', '月环笑蝙蝠', '爱心蝙蝠', '月顶振翼蝙蝠'], '蝙蝠', '夜晚'),
    family('magic-potion', ['星印圆药瓶', '心印晶药瓶', '星印方药瓶', '心形泡泡药瓶'], '魔药', '瓶子'),
  ] },
  { name: '节庆派对', colors: ['#ffc9bf', '#f5a99b', '#966b63'], families: [
    family('gift-box', ['缎结方礼盒', '星顶心礼盒', '星光大结礼盒', '揭盖圆点礼盒'], '礼物', '庆祝'),
    family('party-hat', ['圆点派对帽', '横纹派对帽', '星纹放射帽', '心纹丝结帽'], '派对', '生日'),
    family('firework', ['八束星烟花', '十束心烟花', '十二束星烟花', '十四束繁星烟花'], '烟花', '庆典'),
    family('lantern', ['圆肩流苏灯', '长圆流苏灯', '六角流苏灯', '花窗流苏灯'], '灯笼', '节日'),
    family('bunting', ['三角三旗串', '心印方旗串', '三朵花旗串', '五颗星旗串'], '彩旗', '派对'),
  ] },
  { name: '音乐声场', colors: ['#cdd2f3', '#aeb8e5', '#626b99'], families: [
    family('music-note', ['单旗八分音符', '连梁双音符', '爱心音符', '星头双梁音符'], '音符', '音乐'),
    family('headphones', ['通话耳机', '猫耳耳机', '爱心耳机', '声波耳机'], '耳机', '直播'),
    family('microphone', ['网格立麦', '星光立麦', '星头立麦', '缎结立麦'], '麦克风', '唱歌'),
    family('record', ['黑胶唱片', '心芯唱片', '双轮磁带', '唱针与唱片'], '唱片', '复古'),
    family('equalizer', ['高峰音量条', '跳跃音量条', '空心音量条', '星顶谷形音量条'], '声波', '均衡器'),
  ] },
  { name: '游戏时间', colors: ['#bfe6db', '#92cfbf', '#4e7f73'], families: [
    family('controller', ['双键手柄', '爱心手柄', '星键手柄', '有线四键手柄'], '手柄', '游戏'),
    family('game-console', ['星屏掌机', '心屏圆角掌机', '方块屏掌机', '侧翼播放掌机'], '掌机', '像素'),
    family('dice', ['三点骰子', '五点骰子', '六点骰子', '多面桌游骰'], '骰子', '桌游'),
    family('chess-token', ['圆头棋子', '城堡棋子', '马头棋子', '王冠棋子'], '棋子', '桌游'),
    family('game-badge', ['爱心能量槽', '星星守护盾', '播放齿轮徽章', '升级星标牌'], '徽章', '能量'),
  ] },
  { name: '手帐文具', colors: ['#f5d8b4', '#eac397', '#8e7359'], families: [
    family('pencil', ['削尖铅笔', '星伴铅笔', '波线铅笔', '心叶铅笔'], '铅笔', '书写'),
    family('notebook', ['方签线圈本', '心印圆角本', '星印线圈本', '花印书签本'], '本子', '手帐'),
    family('paint-tool', ['五色调色盘', '尖头画笔', '长柄滚刷', '软管颜料'], '绘画', '美术'),
    family('scissors', ['圆柄剪刀', '心柄剪刀', '锯线剪刀', '张开星光剪刀'], '剪刀', '手作'),
    family('paper-clip', ['三绕回形针', '爱心夹针', '双环长尾夹', '提环票据夹'], '夹子', '办公'),
  ] },
  { name: '标贴边签', colors: ['#f6e6c2', '#ecd8ab', '#92846b'], families: [
    family('speech-bubble', ['三点对话框', '爱心椭圆框', '星印折角框', '笑脸云想框'], '气泡', '对话框'),
    family('ticket-label', ['星印双缺口票', '心印单缺口票', '星印切角票', '心印流星票'], '票根', '标签'),
    family('seal-stamp', ['锯边星印章', '花边心印章', '八角花印章', '圆角勾选章'], '印章', '认可'),
    family('label-banner', ['直边空心横幅', '弧边空心横幅', '结顶空心横幅', '星芯心坠横幅'], '横幅', '丝带'),
    family('sticky-note', ['三行便签', '爱心便签', '星星斜贴便签', '眨眼便签'], '便签', '贴纸'),
  ] },
  { name: '箭头分隔', colors: ['#c8dfea', '#a5c8db', '#5e7b8e'], families: [
    family('pointer-arrow', ['宽尾指向箭头', '空心指向箭头', '心星指向箭头', '三连折角箭头'], '箭头', '指向'),
    family('curved-arrow', ['回旋箭头', '点尾回旋箭头', '弯折折返箭头', '心星回旋箭头'], '箭头', '回旋'),
    family('divider', ['星尖分隔线', '爱心分隔线', '花叶分隔线', '晶珠分隔线'], '分隔线', '排版'),
    family('corner-flourish', ['双线星角', '花叶转角', '心环圆转角', '星群转角'], '角标', '边饰'),
    family('motion-lines', ['三束动感线', '五向强调线', '极速追踪线', '三层弧形声线'], '强调', '动感'),
  ] },
  { name: '皇冠珠宝', colors: ['#ffe2a0', '#edc56b', '#97783f'], families: [
    family('royal-crown', ['三尖宝石冠', '长尖爱心冠', '珠顶波浪冠', '五峰宝石冠'], '皇冠', '王冠'),
    family('cut-gem', ['三角切面钻石', '六角空心晶石', '爱心切面宝石', '空心星形宝石'], '宝石', '闪耀'),
    family('pearl-jewel', ['心坠珍珠链', '星坠珍珠链', '结顶晶坠链', '花坠九珠链'], '珍珠', '项链'),
    family('jewel-ring', ['菱钻戒指', '双心戒指', '花蕊戒指', '群星戒指'], '戒指', '珠宝'),
    family('crystal-cluster', ['三枝水晶簇', '五枝水晶簇', '星伴晶石台', '月伴长晶簇'], '水晶', '晶簇'),
  ] },
  { name: '天气四季', colors: ['#c8e6f6', '#a4d4ed', '#587f9a'], families: [
    family('sunshine', ['八芒小太阳', '十芒笑太阳', '十二芒空心日', '云伴眨眼太阳'], '太阳', '晴天'),
    family('rainbow', ['云端三色虹', '双心四道虹', '星端三道虹', '花叶三道虹'], '彩虹', '晴天'),
    family('umbrella', ['波沿小雨伞', '心印折沿伞', '三滴细雨伞', '丝结星伴伞'], '雨伞', '雨天'),
    family('snow-crystal', ['六枝冰晶', '八枝冰晶', '双梢六枝晶', '心芯繁枝晶'], '雪花', '冬天'),
    family('season-leaf', ['七尖秋枫叶', '细脉长秋叶', '扇形银杏叶', '双叶红果束'], '秋叶', '季节'),
  ] },
  { name: '出发旅行', colors: ['#c7e1df', '#a0cbc9', '#577f80'], families: [
    family('rocket', ['圆窗小火箭', '星纹小火箭', '环窗长焰火箭', '心纹星伴火箭'], '火箭', '出发'),
    family('travel-case', ['星印旅行箱', '心印旅行箱', '圆标旅行箱', '挂牌旅行箱'], '行李箱', '旅行'),
    family('camera', ['圆镜小相机', '心镜闪光相机', '即影即有相机', '双环背带相机'], '相机', '摄影'),
    family('map-pin', ['圆窗地图针', '心窗地图针', '星窗地图针', '花窗落点针'], '地图', '定位'),
    family('mountain', ['日出双山峰', '星月双山峰', '水畔双山峰', '松林双山峰'], '山川', '户外'),
  ] },
  { name: '生活小物', colors: ['#e9d8c3', '#d7baa0', '#8b7562'], families: [
    family('tiny-house', ['烟囱小屋', '花伴心窗小屋', '蘑菇帽小屋', '松树伴小屋'], '房屋', '居家'),
    family('desk-lamp', ['梯罩小台灯', '圆罩光芒灯', '星窗棱角灯', '波罩拉绳灯'], '台灯', '夜读'),
    family('alarm-clock', ['双铃闹钟', '爱心铃闹钟', '星铃反向闹钟', '强调顶杠闹钟'], '闹钟', '时间'),
    family('plant-pot', ['三叶小盆栽', '爱心仙人掌盆', '笑脸圆树盆', '花枝小盆栽'], '盆栽', '绿植'),
    family('sewing-kit', ['四眼纽扣', '绕线卷轴', '穿线绣针', '缝补爱心绣框'], '针线', '手作'),
  ] },
  { name: '魔法书房', colors: ['#dfc9ee', '#c3a7dc', '#775e96'], families: [
    family('magic-wand', ['空心星魔杖', '空心心魔杖', '月星魔杖', '丝结花魔杖'], '魔杖', '魔法'),
    family('spell-book', ['星图咒语书', '月星召唤书', '心花祝福书', '晶环书签书'], '魔法书', '书籍'),
  ] },
];

export const EXTRA_STICKERS: StickerPreset[] = themes.flatMap(theme => theme.families.flatMap(item => item.names.map((name, variant): StickerPreset => {
  const art = candyArt(item.id, variant) ?? coloredStickerArt(item.id, variant);
  return {
    id: `deco-${item.id}-${variant + 1}`, name, category: theme.name,
    tags: [theme.name, ...item.tags, name.includes('空心') ? '线性' : '填充', '原创矢量', '独立分色'],
    ...paintedStickerGeometry(item.id, variant, art.parts),
    style: { ...DEFAULT_STYLE, ...art.style },
  };
})));

