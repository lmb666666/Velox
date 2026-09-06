/** itdog.cn 非官方接口的协议常量。若接口变更，优先用 `pnpm refresh-guard` 更新 auto.js 快照。 */

export const BASE_URL = 'https://www.itdog.cn/';

/** 页面静态资源版本号，用于拼接 JS/缓存参数 */
export const PAGE_VER = '20260609B';

/**
 * WebSocket URL 中的 token 盐（2026-09 从 icmp_ping.js 混淆串还原）。
 * token = md5(task_id + WS_SALT) 十六进制的第 8~24 位。
 * 2024 年前的旧盐为 token_20230313000136kwyktxb0tgspm00yo5，已失效。
 */
export const WS_SALT = 'What this is is no longer important.';

/** WebSocket 默认地址（任务响应里一般会带 wss_url，缺失时兜底） */
export const DEFAULT_WSS_URL = 'https://www.itdog.cn/'.replace('https', 'wss') + 'websockets/';

/** guardret 公式兜底用的异或盐（WAF auto.js 求解失败时使用） */
export const GUARD_XOR_SUFFIX = 'PTNo2n3Ev5';

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

/** 线路编码：/ping/ 等单目标模式的 line 表单值 */
export const LINE_CODES = { telecom: 1, unicom: 2, mobile: 3, overseas: 5 } as const;

/** 线路编码 → 运营商名（与 WS 帧里的 line 字段对应） */
export const CARRIER_BY_LINE: Record<number, string> = {
  1: '电信',
  2: '联通',
  3: '移动',
  5: '境外',
};

/** 省份编码表（WS 帧 province 字段） */
export const PROVINCE_BY_CODE: Record<number, string> = {
  0: '北京', 1: '天津', 2: '上海', 3: '重庆', 4: '河北', 5: '河南', 6: '云南',
  7: '辽宁', 8: '黑龙江', 9: '湖南', 10: '安徽', 11: '山东', 12: '新疆', 13: '江苏',
  14: '浙江', 15: '江西', 16: '湖北', 17: '广西', 18: '甘肃', 19: '山西', 20: '内蒙古',
  21: '陕西', 22: '吉林', 23: '福建', 24: '贵州', 25: '广东', 26: '青海', 27: '西藏',
  28: '四川', 29: '宁夏', 30: '海南', 31: '台湾', 32: '香港', 33: '澳门', 99: '境外',
};

/** 大区编码表（WS 帧 region 字段） */
export const REGION_BY_CODE: Record<number, string> = {
  1: '华东', 2: '华南', 3: '华中', 4: '华北', 5: '西南', 6: '西北', 7: '东北',
  8: '港澳台', 9: '亚洲', 10: '欧洲', 11: '北美洲', 12: '南美洲', 13: '非洲', 14: '大洋洲',
};

/** 节点缓存文件位置 */
export const NODES_CACHE_FILE = 'itdog-cli/nodes.json';

/** 批量任务限制（页面 textarea placeholder 注明） */
export const BATCH_MAX_TARGETS = 256;
export const BATCH_MAX_CHARS = 10000;
