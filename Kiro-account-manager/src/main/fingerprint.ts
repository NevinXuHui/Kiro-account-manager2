/**
 * 浏览器指纹随机化工具
 * 用于生成随机的浏览器配置，降低被检测为自动化的风险
 */

export interface BrowserFingerprint {
  userAgent: string
  viewport: { width: number; height: number }
  locale: string
  timezone: string
  platform: string
  deviceScaleFactor: number
}

// 移动设备 User Agent 列表（Android 和 iOS）
const USER_AGENTS = [
  // Android Chrome
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 6 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  // iOS Safari
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
]

// 移动设备屏幕分辨率
const VIEWPORTS = [
  // iPhone 尺寸
  { width: 375, height: 667 },  // iPhone SE, 6, 7, 8
  { width: 390, height: 844 },  // iPhone 12, 13, 14
  { width: 393, height: 852 },  // iPhone 14 Pro, 15
  { width: 414, height: 896 },  // iPhone 11, XR, XS Max
  { width: 428, height: 926 },  // iPhone 12 Pro Max, 13 Pro Max, 14 Plus
  // Android 尺寸
  { width: 360, height: 640 },  // 常见 Android 小屏
  { width: 412, height: 915 },  // Pixel 7
  { width: 384, height: 854 },  // Samsung Galaxy S21
  { width: 360, height: 780 },  // 常见 Android 中屏
  // iPad 尺寸
  { width: 768, height: 1024 }, // iPad
  { width: 820, height: 1180 }  // iPad Air
]

// 常见的语言/地区设置
const LOCALES = ['en-US', 'en-GB', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES']

// 常见的时区
const TIMEZONES = [
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney'
]

// 移动设备平台标识
const PLATFORMS = ['Linux armv8l', 'Linux aarch64', 'iPhone', 'iPad']

// 移动设备像素比（通常为 2x 或 3x）
const DEVICE_SCALE_FACTORS = [2, 3]

/**
 * 从数组中随机选择一个元素
 */
function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

/**
 * 生成随机的浏览器指纹
 */
export function generateRandomFingerprint(): BrowserFingerprint {
  return {
    userAgent: randomChoice(USER_AGENTS),
    viewport: randomChoice(VIEWPORTS),
    locale: randomChoice(LOCALES),
    timezone: randomChoice(TIMEZONES),
    platform: randomChoice(PLATFORMS),
    deviceScaleFactor: randomChoice(DEVICE_SCALE_FACTORS)
  }
}

/**
 * 生成与 User Agent 匹配的平台标识
 */
export function getPlatformFromUserAgent(userAgent: string): string {
  if (userAgent.includes('iPhone')) return 'iPhone'
  if (userAgent.includes('iPad')) return 'iPad'
  if (userAgent.includes('Android')) return 'Linux armv8l'
  return 'Linux armv8l'
}

/**
 * 生成更智能的随机指纹（确保 User Agent 和平台匹配）
 */
export function generateSmartFingerprint(): BrowserFingerprint {
  const userAgent = randomChoice(USER_AGENTS)
  const platform = getPlatformFromUserAgent(userAgent)

  return {
    userAgent,
    viewport: randomChoice(VIEWPORTS),
    locale: randomChoice(LOCALES),
    timezone: randomChoice(TIMEZONES),
    platform,
    deviceScaleFactor: randomChoice(DEVICE_SCALE_FACTORS)
  }
}
