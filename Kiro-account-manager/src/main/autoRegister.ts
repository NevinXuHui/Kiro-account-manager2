/**
 * AWS Builder ID 自动注册模块
 * 完全集成在 Electron 中，不依赖外部 Python 脚本
 *
 * 注意：验证码需要手动输入
 */

import { chromium, Browser, Page, Locator } from 'playwright'
import { generateSmartFingerprint } from './fingerprint'
import { ssoDeviceAuth } from './index'

// 日志回调类型
type LogCallback = (message: string) => void

// 验证码正则表达式 - 与 Python 版本保持一致
const CODE_PATTERNS = [
  // AWS/Amazon 验证码格式
  /(?:verification\s*code|验证码|Your code is|code is)[：:\s]*(\d{6})/gi,
  /(?:is|为)[：:\s]*(\d{6})\b/gi,
  // 验证码通常单独一行或在特定上下文中
  /^\s*(\d{6})\s*$/gm, // 单独一行的6位数字
  />\s*(\d{6})\s*</g // HTML标签之间的6位数字
]

// AWS 验证码发件人
const AWS_SENDERS = [
  'no-reply@signin.aws', // AWS 新发件人
  'no-reply@login.awsapps.com',
  'noreply@amazon.com',
  'account-update@amazon.com',
  'no-reply@aws.amazon.com',
  'noreply@aws.amazon.com',
  'aws' // 模糊匹配
]

function generateRandomName(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const first = chars[Math.floor(Math.random() * chars.length)]
  const second = chars[Math.floor(Math.random() * chars.length)]
  return `${first}${second}`
}

/**
 * 生成随机的设备授权码（格式：XXXX-XXXX）
 */
function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 排除容易混淆的字符 (I, O, 0, 1)
  const part1 = Array.from(
    { length: 4 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join('')
  const part2 = Array.from(
    { length: 4 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join('')
  return `${part1}-${part2}`
}

/**
 * 随机延时，模拟真实用户行为
 * @param baseMs 基础延时时间（毫秒）
 * @param variance 波动范围（0-1），默认0.3表示±30%
 * @returns 随机延时时间（毫秒）
 */
function randomDelay(baseMs: number, variance: number = 0.3): number {
  const min = baseMs * (1 - variance)
  const max = baseMs * (1 + variance)
  return Math.floor(Math.random() * (max - min + 1) + min)
}

/**
 * 等待页面完全稳定
 * @param page Playwright Page对象
 * @param log 日志回调函数
 * @param description 操作描述
 */
async function waitForPageStable(
  page: Page,
  log: LogCallback,
  description: string = '页面'
): Promise<void> {
  try {
    log(`等待${description}稳定...`)

    // 等待 DOM 加载完成
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 })

    // 等待网络空闲
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    // 额外延时确保页面完全渲染
    await page.waitForTimeout(randomDelay(2000, 0.3))

    log(`✓ ${description}已稳定`)
  } catch (error) {
    log(`⚠ 等待${description}稳定时出错: ${error}`)
  }
}

/**
 * 模拟鼠标移动到元素位置（带轨迹）
 * @param page Playwright Page对象
 * @param element 目标元素
 * @param log 日志回调函数
 */
async function moveMouseToElement(page: Page, element: Locator, log: LogCallback): Promise<void> {
  try {
    // 获取元素的边界框
    const box = await element.boundingBox()
    if (!box) {
      log('⚠ 无法获取元素位置，跳过鼠标移动')
      return
    }

    // 计算目标位置（元素中心点附近的随机位置）
    const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * box.width * 0.3
    const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * box.height * 0.3

    // 获取当前鼠标位置（如果是第一次，从随机起点开始）
    const viewport = page.viewportSize()
    // 当 viewport 为 null 时（最大化窗口），使用实际窗口大小
    const viewportWidth = viewport?.width || 1920
    const viewportHeight = viewport?.height || 1080
    const startX = Math.random() * viewportWidth
    const startY = Math.random() * viewportHeight

    // 计算移动步数（根据距离决定）
    const distance = Math.sqrt(Math.pow(targetX - startX, 2) + Math.pow(targetY - startY, 2))
    const steps = Math.max(5, Math.min(20, Math.floor(distance / 50)))

    // 模拟贝塞尔曲线移动
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      // 使用二次贝塞尔曲线，添加随机控制点
      const controlX = (startX + targetX) / 2 + (Math.random() - 0.5) * 100
      const controlY = (startY + targetY) / 2 + (Math.random() - 0.5) * 100

      const x = Math.pow(1 - t, 2) * startX + 2 * (1 - t) * t * controlX + Math.pow(t, 2) * targetX
      const y = Math.pow(1 - t, 2) * startY + 2 * (1 - t) * t * controlY + Math.pow(t, 2) * targetY

      await page.mouse.move(x, y)

      // 每步之间添加随机延迟（5-15ms）
      await page.waitForTimeout(randomDelay(10, 0.5))
    }

    log('✓ 鼠标已移动到目标位置')
  } catch (error) {
    log(`⚠ 鼠标移动失败: ${error}`)
  }
}

/**
 * 页面加载后的随机交互行为（模拟真实用户浏览）
 * @param page Playwright Page对象
 * @param log 日志回调函数
 */
async function randomPageInteraction(page: Page, log: LogCallback): Promise<void> {
  try {
    const viewport = page.viewportSize()
    if (!viewport) return

    // 10-30%的概率执行随机交互
    if (Math.random() > 0.3) return

    log('执行随机页面交互...')

    // 随机移动鼠标到页面上的某个位置
    const randomX = Math.random() * viewport.width
    const randomY = Math.random() * viewport.height

    // 分多步移动到随机位置
    const steps = randomDelay(8, 0.3) // 5-10步
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const currentX = randomX * t
      const currentY = randomY * t
      await page.mouse.move(currentX, currentY)
      await page.waitForTimeout(randomDelay(15, 0.5))
    }

    // 50%的概率进行滚动
    if (Math.random() > 0.5) {
      const scrollAmount = randomDelay(200, 0.5) // 100-300px
      await page.mouse.wheel(0, scrollAmount)
      await page.waitForTimeout(randomDelay(300, 0.3))
    }

    log('✓ 随机页面交互完成')
  } catch (error) {
    log(`⚠ 随机页面交互失败: ${error}`)
  }
}

// HTML 转文本 - 改进版本
function htmlToText(html: string): string {
  if (!html) return ''

  let text = html

  // 解码 HTML 实体
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))

  // 移除 style 和 script 标签及其内容
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')

  // 将 br 和 p 标签转换为换行
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/p>/gi, '\n')
  text = text.replace(/<\/div>/gi, '\n')

  // 移除所有 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ')

  // 清理多余空白
  text = text.replace(/\s+/g, ' ')

  return text.trim()
}

// 从文本提取验证码 - 改进版本，与 Python 保持一致
function extractCode(text: string): string | null {
  if (!text) return null

  for (const pattern of CODE_PATTERNS) {
    // 重置正则表达式的 lastIndex
    pattern.lastIndex = 0

    let match
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1]
      if (code && /^\d{6}$/.test(code)) {
        // 获取上下文进行排除检查
        const start = Math.max(0, match.index - 20)
        const end = Math.min(text.length, match.index + match[0].length + 20)
        const context = text.slice(start, end)

        // 排除颜色代码 (#XXXXXX)
        if (context.includes('#' + code)) continue

        // 排除 CSS 颜色相关
        if (/color[:\s]*[^;]*\d{6}/i.test(context)) continue
        if (/rgb|rgba|hsl/i.test(context)) continue

        // 排除超过6位的数字（电话号码、邮编等）
        if (/\d{7,}/.test(context)) continue

        return code
      }
    }
  }
  return null
}

/**
 * 从 Outlook 邮箱获取验证码
 * 使用 Microsoft Graph API，与 Python 版本保持一致
 */
export async function getOutlookVerificationCode(
  refreshToken: string,
  clientId: string,
  log: LogCallback,
  timeout: number = 120
): Promise<string | null> {
  log('========== 开始获取邮箱验证码 ==========')
  log(`client_id: ${clientId}`)
  log(`refresh_token: ${refreshToken.substring(0, 30)}...`)

  const startTime = Date.now()
  const checkInterval = 5000 // 5秒检查一次
  const checkedIds = new Set<string>()

  while (Date.now() - startTime < timeout * 1000) {
    try {
      // 刷新 access_token
      log('刷新 access_token...')
      let accessToken: string | null = null

      const tokenAttempts = [
        { url: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token', scope: null },
        { url: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', scope: null }
      ]

      for (const attempt of tokenAttempts) {
        try {
          const tokenBody = new URLSearchParams()
          tokenBody.append('client_id', clientId)
          tokenBody.append('refresh_token', refreshToken)
          tokenBody.append('grant_type', 'refresh_token')
          if (attempt.scope) {
            tokenBody.append('scope', attempt.scope)
          }

          const tokenResponse = await fetch(attempt.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenBody.toString()
          })

          if (tokenResponse.ok) {
            const tokenResult = (await tokenResponse.json()) as { access_token: string }
            accessToken = tokenResult.access_token
            log('✓ 成功获取 access_token')
            break
          }
        } catch {
          continue
        }
      }

      if (!accessToken) {
        log('✗ token 刷新失败')
        return null
      }

      // 获取邮件
      log('获取邮件列表...')
      const graphParams = new URLSearchParams({
        $top: '50',
        $orderby: 'receivedDateTime desc',
        $select: 'id,subject,from,receivedDateTime,bodyPreview,body'
      })

      const mailResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/messages?${graphParams}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      )

      if (!mailResponse.ok) {
        log(`获取邮件失败: ${mailResponse.status}`)
        await new Promise((r) => setTimeout(r, checkInterval))
        continue
      }

      const mailData = (await mailResponse.json()) as {
        value: Array<{
          id: string
          subject: string
          from: { emailAddress: { address: string } }
          body: { content: string }
          bodyPreview: string
          receivedDateTime: string
        }>
      }

      log(`获取到 ${mailData.value?.length || 0} 封邮件`)

      // 搜索最新的 AWS 邮件
      for (const mail of mailData.value || []) {
        const fromEmail = mail.from?.emailAddress?.address?.toLowerCase() || ''
        const isAwsSender = AWS_SENDERS.some((s) => fromEmail.includes(s.toLowerCase()))

        if (isAwsSender && !checkedIds.has(mail.id)) {
          checkedIds.add(mail.id)

          log(`\n=== 检查 AWS 邮件 ===`)
          log(`  发件人: ${fromEmail}`)
          log(`  主题: ${mail.subject?.substring(0, 50)}`)

          // 提取验证码
          let code: string | null = null
          const bodyText = htmlToText(mail.body?.content || '')
          if (bodyText) {
            code = extractCode(bodyText)
          }
          if (!code) {
            code = extractCode(mail.body?.content || '')
          }
          if (!code) {
            code = extractCode(mail.bodyPreview || '')
          }

          if (code) {
            log(`\n========== 找到验证码: ${code} ==========`)
            return code
          }
        }
      }

      log(`未找到验证码，${checkInterval / 1000}秒后重试...`)
      await new Promise((r) => setTimeout(r, checkInterval))
    } catch (error) {
      log(`获取验证码出错: ${error}`)
      await new Promise((r) => setTimeout(r, checkInterval))
    }
  }

  log('获取验证码超时')
  return null
}

/**
 * 等待输入框出现并输入内容（带重试机制和稳定性检查）
 */
async function waitAndFill(
  page: Page,
  selector: string,
  value: string,
  log: LogCallback,
  description: string,
  timeout: number = 30000,
  maxRetries: number = 3,
  typeCharByChar: boolean = true // 是否逐字符输入，false则直接粘贴
): Promise<boolean> {
  let retryCount = 0

  while (retryCount < maxRetries) {
    log(`等待${description}出现... (尝试 ${retryCount + 1}/${maxRetries})`)
    try {
      const element = page.locator(selector).first()

      // 等待元素可见
      await element.waitFor({ state: 'visible', timeout })

      // 等待元素稳定（不再移动或变化）
      await element.waitFor({ state: 'attached', timeout: 5000 })

      // 额外等待确保页面完全渲染
      await page.waitForTimeout(800)

      // 模拟鼠标移动到输入框
      await moveMouseToElement(page, element, log)
      await page.waitForTimeout(randomDelay(200, 0.3))

      // 清空输入框
      await element.clear()
      await page.waitForTimeout(300)

      // 点击输入框，确保焦点在输入框上
      await element.click()
      await page.waitForTimeout(200)

      if (typeCharByChar) {
        // 逐字符输入，模拟真实用户打字
        log(`开始逐字符输入${description}...`)
        for (let i = 0; i < value.length; i++) {
          const char = value[i]

          // 使用 keyboard.type 输入单个字符
          await page.keyboard.type(char)

          // 每个字符之间添加随机延迟，模拟真实打字速度
          // 基础延迟 80-150ms，偶尔有较长停顿
          const baseDelay = randomDelay(115, 0.3) // 80-150ms

          // 10%的概率有较长停顿（模拟思考）
          const shouldPause = Math.random() < 0.1
          const charDelay = shouldPause ? baseDelay * 2 : baseDelay

          await page.waitForTimeout(charDelay)
        }
      } else {
        // 直接粘贴输入（快速填入）
        log(`直接填入${description}...`)
        await element.fill(value)
      }

      log(`✓ 已输入${description}: ${value}`)
      return true
    } catch (error) {
      retryCount++
      if (retryCount < maxRetries) {
        log(`⚠ ${description}操作失败，等待后重试...`)
        await page.waitForTimeout(randomDelay(2000))
      } else {
        log(`✗ ${description}操作失败（已重试${maxRetries}次）: ${error}`)
        return false
      }
    }
  }

  return false
}

/**
 * 等待用户手动输入内容
 */
async function waitForManualInput(
  page: Page,
  selector: string,
  log: LogCallback,
  description: string,
  timeout: number = 300000 // 5分钟超时
): Promise<boolean> {
  log(`等待${description}出现...`)
  try {
    const element = page.locator(selector).first()
    await element.waitFor({ state: 'visible', timeout: 30000 })
    log(`✓ ${description}已出现，请手动输入...`)

    // 等待用户输入（检查输入框的值是否为6位数字）
    const startTime = Date.now()
    while (Date.now() - startTime < timeout) {
      const value = await element.inputValue()
      // 检查是否为6位数字
      if (value && /^\d{6}$/.test(value.trim())) {
        log(`✓ 检测到${description}已输入: ${value}`)
        return true
      }
      await page.waitForTimeout(1000) // 每秒检查一次
    }

    log(`✗ 等待${description}输入超时`)
    return false
  } catch (error) {
    log(`✗ ${description}操作失败: ${error}`)
    return false
  }
}

/**
 * 尝试多个选择器点击
 */
async function tryClickSelectors(
  page: Page,
  selectors: string[],
  log: LogCallback,
  description: string,
  timeout: number = 15000
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const element = page.locator(selector).first()
      await element.waitFor({ state: 'visible', timeout: timeout / selectors.length })
      await page.waitForTimeout(300)
      await element.click()
      log(`✓ 已点击${description}`)
      return true
    } catch {
      continue
    }
  }
  log(`✗ 未找到${description}`)
  return false
}

/**
 * 检测 AWS 错误弹窗并重试点击按钮
 * 错误弹窗选择器: div.awsui_content_mx3cw_97dyn_391 包含 "抱歉，处理您的请求时出错"
 */
async function checkAndRetryOnError(
  page: Page,
  buttonSelector: string,
  log: LogCallback,
  description: string,
  maxRetries: number = 3,
  retryDelay: number = 2000
): Promise<boolean> {
  // 错误弹窗的多种可能选择器
  const errorSelectors = [
    'div.awsui_content_mx3cw_97dyn_391',
    '[class*="awsui_content_"]',
    '.awsui-flash-error',
    '[data-testid="flash-error"]'
  ]

  const errorTexts = [
    '抱歉，处理您的请求时出错',
    'Sorry, there was an error processing your request',
    'error processing your request',
    'Please try again',
    '请重试'
  ]

  for (let retry = 0; retry < maxRetries; retry++) {
    // 等待一下让页面响应
    await page.waitForTimeout(1500)

    // 检查是否有错误弹窗
    let hasError = false
    for (const selector of errorSelectors) {
      try {
        const errorElements = await page.locator(selector).all()
        for (const el of errorElements) {
          const text = await el.textContent()
          if (text && errorTexts.some((errText) => text.includes(errText))) {
            hasError = true
            log(`⚠ 检测到错误弹窗: "${text.substring(0, 50)}..."`)
            break
          }
        }
        if (hasError) break
      } catch {
        continue
      }
    }

    if (!hasError) {
      // 没有错误，操作成功
      return true
    }

    if (retry < maxRetries - 1) {
      log(`重试点击${description} (${retry + 2}/${maxRetries})...`)
      await page.waitForTimeout(retryDelay)

      // 重新点击按钮
      try {
        const button = page.locator(buttonSelector).first()
        await button.waitFor({ state: 'visible', timeout: 5000 })
        await button.click()
        log(`✓ 已重新点击${description}`)
      } catch (e) {
        log(`✗ 重新点击${description}失败: ${e}`)
      }
    }
  }

  log(`✗ ${description}多次重试后仍然失败`)
  return false
}

/**
 * 等待按钮出现并点击，带错误检测（不自动重试）
 */
async function waitAndClickWithRetry(
  page: Page,
  selector: string,
  log: LogCallback,
  description: string,
  timeout: number = 30000,
  maxRetries: number = 1 // 默认不重试，失败直接报错
): Promise<boolean> {
  let retryCount = 0

  while (retryCount < maxRetries) {
    log(
      `等待${description}出现...${maxRetries > 1 ? ` (尝试 ${retryCount + 1}/${maxRetries})` : ''}`
    )
    try {
      const element = page.locator(selector).first()

      // 等待元素可见
      await element.waitFor({ state: 'visible', timeout })

      // 等待元素稳定（不再移动或变化）
      await element.waitFor({ state: 'attached', timeout: 5000 })

      // 额外等待确保页面完全渲染和元素可交互
      await page.waitForTimeout(800)

      // 模拟鼠标移动到按钮
      await moveMouseToElement(page, element, log)
      await page.waitForTimeout(randomDelay(200, 0.3))

      // 点击元素
      await element.click()
      log(`✓ 已点击${description}`)

      // 检查是否有错误弹窗，如果有则重试
      const success = await checkAndRetryOnError(page, selector, log, description, maxRetries)
      return success
    } catch (error) {
      retryCount++
      if (retryCount < maxRetries) {
        log(`⚠ 点击${description}失败，等待后重试...`)
        await page.waitForTimeout(randomDelay(2000))
      } else {
        log(`✗ 点击${description}失败: ${error}`)
        return false
      }
    }
  }

  return false
}

/**
 * Outlook 邮箱激活
 * 在 AWS 注册之前激活 Outlook 邮箱，确保能正常接收验证码
 */
export async function activateOutlook(
  email: string,
  emailPassword: string,
  log: LogCallback
): Promise<{ success: boolean; error?: string }> {
  const activationUrl = 'https://go.microsoft.com/fwlink/p/?linkid=2125442'
  let browser: Browser | null = null

  log('========== 开始激活 Outlook 邮箱 ==========')
  log(`邮箱: ${email}`)

  try {
    // 启动浏览器
    log('\n步骤1: 启动浏览器，访问 Outlook 激活页面...')

    // 计算窗口居中位置
    const viewportWidth = 1280
    const viewportHeight = 900
    const screenWidth = 1920
    const screenHeight = 1080
    const windowX = Math.floor((screenWidth - viewportWidth) / 2)
    const windowY = Math.floor((screenHeight - viewportHeight) / 2)

    browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        `--window-position=${windowX},${windowY}`,
        '--start-maximized'
      ]
    })

    const context = await browser.newContext({
      // 移除固定 viewport，让浏览器使用最大化窗口尺寸
      // viewport: { width: viewportWidth, height: viewportHeight },
      viewport: null, // 使用实际窗口大小
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })

    const page = await context.newPage()

    await page.goto(activationUrl, { waitUntil: 'networkidle', timeout: 60000 })
    log('✓ 页面加载完成')
    await page.waitForTimeout(2000)

    // 步骤2: 等待邮箱输入框出现并输入邮箱
    log('\n步骤2: 输入邮箱...')
    const emailInputSelectors = [
      'input#i0116[type="email"]',
      'input[name="loginfmt"]',
      'input[type="email"]'
    ]

    let emailFilled = false
    for (const selector of emailInputSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 10000 })
        await element.fill(email)
        log(`✓ 已输入邮箱: ${email}`)
        emailFilled = true
        break
      } catch {
        continue
      }
    }

    if (!emailFilled) {
      throw new Error('未找到邮箱输入框')
    }

    await page.waitForTimeout(1000)

    // 步骤3: 点击第一个下一步按钮
    log('\n步骤3: 点击下一步按钮...')
    const firstNextSelectors = [
      'input#idSIButton9[type="submit"]',
      'input[type="submit"][value="下一步"]',
      'input[type="submit"][value="Next"]'
    ]

    if (!(await tryClickSelectors(page, firstNextSelectors, log, '第一个下一步按钮'))) {
      throw new Error('点击第一个下一步按钮失败')
    }

    await page.waitForTimeout(3000)

    // 步骤4: 等待密码输入框出现并输入密码
    log('\n步骤4: 输入密码...')
    const passwordInputSelectors = [
      'input#passwordEntry[type="password"]',
      'input#i0118[type="password"]',
      'input[name="passwd"][type="password"]',
      'input[type="password"]'
    ]

    let passwordFilled = false
    for (const selector of passwordInputSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 15000 })
        await element.fill(emailPassword)
        log('✓ 已输入密码')
        passwordFilled = true
        break
      } catch {
        continue
      }
    }

    if (!passwordFilled) {
      throw new Error('未找到密码输入框')
    }

    await page.waitForTimeout(1000)

    // 步骤5: 点击第二个下一步/登录按钮
    log('\n步骤5: 点击登录按钮...')
    const loginButtonSelectors = [
      'button[type="submit"][data-testid="primaryButton"]',
      'input#idSIButton9[type="submit"]',
      'button:has-text("下一步")',
      'button:has-text("登录")',
      'button:has-text("Sign in")',
      'button:has-text("Next")'
    ]

    if (!(await tryClickSelectors(page, loginButtonSelectors, log, '登录按钮'))) {
      throw new Error('点击登录按钮失败')
    }

    await page.waitForTimeout(3000)

    // 步骤6: 等待第一个"暂时跳过"链接并点击
    log('\n步骤6: 点击第一个"暂时跳过"链接...')
    const skipSelector = 'a#iShowSkip'
    try {
      const skipElement = page.locator(skipSelector).first()
      await skipElement.waitFor({ state: 'visible', timeout: 30000 })
      await skipElement.click()
      log('✓ 已点击第一个"暂时跳过"')
      await page.waitForTimeout(3000)
    } catch {
      log('未找到第一个"暂时跳过"链接，可能已跳过此步骤')
    }

    // 步骤7: 等待第二个"暂时跳过"链接并点击
    log('\n步骤7: 点击第二个"暂时跳过"链接...')
    try {
      const skipElement = page.locator(skipSelector).first()
      await skipElement.waitFor({ state: 'visible', timeout: 15000 })
      await skipElement.click()
      log('✓ 已点击第二个"暂时跳过"')
      await page.waitForTimeout(3000)
    } catch {
      log('未找到第二个"暂时跳过"链接，可能已跳过此步骤')
    }

    // 步骤8: 等待"取消"按钮（密钥创建对话框）并点击
    log('\n步骤8: 点击"取消"按钮（跳过密钥创建）...')
    const cancelButtonSelectors = [
      'button[data-testid="secondaryButton"]:has-text("取消")',
      'button[data-testid="secondaryButton"]:has-text("Cancel")',
      'button[type="button"]:has-text("取消")',
      'button[type="button"]:has-text("Cancel")'
    ]

    if (!(await tryClickSelectors(page, cancelButtonSelectors, log, '"取消"按钮', 15000))) {
      log('未找到"取消"按钮，可能已跳过此步骤')
    }

    await page.waitForTimeout(3000)

    // 步骤9: 等待"是"按钮（保持登录状态）并点击
    log('\n步骤9: 点击"是"按钮（保持登录状态）...')
    const yesButtonSelectors = [
      'button[type="submit"][data-testid="primaryButton"]:has-text("是")',
      'button[type="submit"][data-testid="primaryButton"]:has-text("Yes")',
      'input#idSIButton9[value="是"]',
      'input#idSIButton9[value="Yes"]',
      'button:has-text("是")',
      'button:has-text("Yes")'
    ]

    if (!(await tryClickSelectors(page, yesButtonSelectors, log, '"是"按钮', 15000))) {
      log('未找到"是"按钮，可能已跳过此步骤')
    }

    await page.waitForTimeout(5000)

    // 步骤10: 等待 Outlook 邮箱加载完成
    log('\n步骤10: 等待 Outlook 邮箱加载完成...')
    const newMailSelectors = [
      'button[aria-label="New mail"]',
      'button:has-text("New mail")',
      'button:has-text("新邮件")',
      'span:has-text("New mail")',
      '[data-automation-type="RibbonSplitButton"]'
    ]

    let outlookLoaded = false
    for (const selector of newMailSelectors) {
      try {
        const element = page.locator(selector).first()
        await element.waitFor({ state: 'visible', timeout: 30000 })
        log('✓ Outlook 邮箱激活成功！')
        outlookLoaded = true
        break
      } catch {
        continue
      }
    }

    if (!outlookLoaded) {
      // 检查是否已经在收件箱页面
      const currentUrl = page.url()
      if (
        currentUrl.toLowerCase().includes('outlook') ||
        currentUrl.toLowerCase().includes('mail')
      ) {
        log('✓ 已进入 Outlook 邮箱页面，激活成功！')
        outlookLoaded = true
      }
    }

    await page.waitForTimeout(2000)
    await browser.close()
    browser = null

    if (outlookLoaded) {
      log('\n========== Outlook 邮箱激活完成 ==========')
      return { success: true }
    } else {
      log('\n⚠ Outlook 邮箱激活可能未完成')
      return { success: false, error: 'Outlook 邮箱激活可能未完成' }
    }
  } catch (error) {
    log(`\n✗ Outlook 激活失败: ${error}`)
    if (browser) {
      try {
        await browser.close()
      } catch {}
    }
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * AWS Builder ID 自动注册
 * @param email 邮箱地址（如果启用邮箱服务且为 null，则自动创建临时邮箱）
 * @param log 日志回调
 * @param proxyUrl 代理地址（用于 AWS 注册）
 * @param testLoginDetection 是否在注册成功后测试登录流程判断逻辑（默认 true）
 * @param keepBrowserOpen 是否在操作完成后保持浏览器打开
 * @param mailServiceConfig 邮箱服务配置（可选）
 */
export async function autoRegisterAWS(
  email: string | null,
  log: LogCallback,
  proxyUrl?: string,
  testLoginDetection: boolean = true,
  keepBrowserOpen: boolean = false,
  mailServiceConfig?: {
    enabled: boolean
    apiUrl: string
    apiKey: string
    mailDomain: string
  }
): Promise<{
  success: boolean
  ssoToken?: string
  name?: string
  accessToken?: string
  refreshToken?: string
  error?: string
}> {
  const password = 'admin123456aA!'
  const randomName = generateRandomName()
  const userCode = generateUserCode() // 生成随机的设备授权码
  let browser: Browser | null = null
  let tempMailbox: { email: string; password: string } | null = null
  let mailService: any = null

  log('========== 开始 AWS Builder ID 注册 ==========')

  try {
    // 步骤0: 如果启用了邮箱服务且未提供邮箱，则自动创建临时邮箱
    if (mailServiceConfig?.enabled && !email) {
      log('\n步骤0: 启用自动邮箱服务，创建临时邮箱...')
      const { MailService } = await import('./mailService')
      mailService = new MailService(mailServiceConfig)

      // 检查服务是否可用
      const isHealthy = await mailService.checkHealth()
      if (!isHealthy) {
        throw new Error('邮箱服务不可用，请检查配置')
      }
      log('✓ 邮箱服务连接正常')

      // 创建临时邮箱
      tempMailbox = await mailService.createMailbox()
      if (!tempMailbox) {
        throw new Error('创建临时邮箱失败')
      }
      email = tempMailbox.email
      log(`✓ 临时邮箱创建成功: ${email}`)
    }

    if (!email) {
      throw new Error('未提供邮箱地址且邮箱服务未启用')
    }

    log(`邮箱: ${email}`)
    log(`姓名: ${randomName}`)
    log(`设备授权码: ${userCode}`)
    log(`密码: ${password}`)
    if (proxyUrl) {
      log(`代理: ${proxyUrl}`)
    }
    // 步骤1: 创建浏览器，进入注册页面（使用代理）
    log('\n步骤1: 创建全新的浏览器实例，进入注册页面...')
    log('注意：每次注册都会创建独立的浏览器实例，确保完全隔离')

    // 生成随机指纹
    const fingerprint = generateSmartFingerprint()
    log(`使用随机指纹: ${fingerprint.userAgent.substring(0, 50)}...`)
    log(`视口大小: ${fingerprint.viewport.width}x${fingerprint.viewport.height}`)
    log(`语言: en-US (固定)`)

    // 计算窗口居中位置（假设屏幕分辨率为 1920x1080）
    const screenWidth = 1920
    const screenHeight = 1080
    const windowX = Math.floor((screenWidth - fingerprint.viewport.width) / 2)
    const windowY = Math.floor((screenHeight - fingerprint.viewport.height) / 2)

    // 创建全新的浏览器实例（每次注册都是独立的）
    browser = await chromium.launch({
      headless: false,
      proxy: proxyUrl ? { server: proxyUrl } : undefined,
      args: [
        '--disable-blink-features=AutomationControlled',
        `--window-position=${windowX},${windowY}`,
        '--start-maximized'
      ]
    })

    const context = await browser.newContext({
      viewport: null, // 移除固定 viewport，让浏览器使用最大化窗口尺寸
      userAgent: fingerprint.userAgent,
      locale: 'en-US', // 固定使用英语
      timezoneId: 'America/New_York' // 固定使用美国东部时区
      // deviceScaleFactor 与 viewport: null 不兼容，已移除
    })

    // 彻底清除浏览器数据（在访问页面之前）
    log('彻底清除浏览器数据...')
    await context.clearCookies()
    await context.clearPermissions()
    log('✓ Cookies 和权限已清除')

    const page = await context.newPage()

    // 在页面加载时立即清除所有浏览器存储
    await page.addInitScript(() => {
      // 同步清除 localStorage 和 sessionStorage
      try {
        localStorage.clear()
        sessionStorage.clear()
      } catch (e) {
        console.error('清除 Storage 失败:', e)
      }

      // 异步清除 IndexedDB、Cache Storage 和 Service Workers
      // 这些操作会在页面加载过程中完成
      Promise.resolve().then(async () => {
        try {
          // 清除 IndexedDB
          if (window.indexedDB && window.indexedDB.databases) {
            const dbs = await window.indexedDB.databases()
            await Promise.all(
              dbs.map((db) => {
                if (db.name) {
                  return new Promise<void>((resolve) => {
                    const request = window.indexedDB.deleteDatabase(db.name!)
                    request.onsuccess = () => resolve()
                    request.onerror = () => resolve() // 失败也继续
                    request.onblocked = () => resolve() // 被阻塞也继续
                  })
                }
                return Promise.resolve()
              })
            )
          }

          // 清除 Cache Storage
          if ('caches' in window) {
            const names = await caches.keys()
            await Promise.all(names.map((name) => caches.delete(name)))
          }

          // 清除 Service Workers
          if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations()
            await Promise.all(registrations.map((registration) => registration.unregister()))
          }
        } catch (e) {
          console.error('清除浏览器存储失败:', e)
        }
      })
    })

    log(
      '✓ 已设置页面初始化脚本（清除所有浏览器存储：Cookies、Storage、IndexedDB、Cache、Service Workers）'
    )

    const registerUrl = `https://view.awsapps.com/start/#/device?user_code=${userCode}`
    log(`访问注册页面: ${registerUrl}`)
    await page.goto(registerUrl, { waitUntil: 'networkidle', timeout: 60000 })
    log('✓ 页面加载完成（已清除所有浏览器数据）')

    // 等待页面完全渲染和稳定
    await page.waitForLoadState('domcontentloaded')
    await page.waitForLoadState('networkidle')
    log('✓ 页面DOM和网络已稳定')

    // 页面加载后的随机延时，确保页面完全显示
    await page.waitForTimeout(randomDelay(5000, 0.4))
    log('✓ 页面已完全显示，准备开始操作')

    // 模拟真实用户浏览行为
    await randomPageInteraction(page, log)

    // 等待邮箱输入框出现并自动填入邮箱
    // 选择器: input[placeholder="username@example.com"]
    const emailInputSelector = 'input[placeholder="username@example.com"]'
    if (
      !(await waitAndFill(page, emailInputSelector, email, log, '邮箱输入框', 30000, 999, false))
    ) {
      throw new Error('未找到邮箱输入框')
    }

    // 输入完成后的随机延时，模拟真实用户思考时间
    await page.waitForTimeout(randomDelay(1500, 0.5))

    // 点击第一个继续按钮（带错误检测和自动重试）
    // 选择器: button[data-testid="test-primary-button"]
    const firstContinueSelector = 'button[data-testid="test-primary-button"]'
    if (!(await waitAndClickWithRetry(page, firstContinueSelector, log, '第一个继续按钮'))) {
      throw new Error('点击第一个继续按钮失败')
    }

    // 等待页面稳定
    await waitForPageStable(page, log, '点击后的页面')

    // 调试：输出页面上所有的 input 元素信息
    // 检测是否是已注册账号（登录页面）
    // 关键判断逻辑：
    // 1. 姓名输入框出现 → 未注册（注册流程）
    // 2. "Sign in with your AWS Builder ID"标题 → 已注册（登录流程）
    // 3. 密码输入框（登录用）出现 → 已注册（登录流程）
    // 注意：不能用验证码输入框判断，因为注册和登录流程都有验证码步骤
    const loginHeadingSelector =
      'span[class*="awsui_heading-text"]:has-text("Sign in with your AWS Builder ID")'

    // 姓名输入框的多个可能选择器
    const nameInputSelectors = [
      'input[placeholder="Maria José Silva"]',
      'input[placeholder*="Silva"]',
      'input[placeholder*="Maria"]',
      'input[placeholder*="José"]',
      'input[name="fullName"]',
      'input[id*="name"]',
      'input[data-testid*="name"]'
    ]

    const loginPasswordSelector = 'input[placeholder="Enter password"]'

    let isLoginFlow = false
    let isVerifyFlow = false // 直接进入验证码步骤的登录流程

    try {
      // 优先检测姓名输入框（注册流程的明确标志）
      // 尝试多个选择器
      const nameInputPromises = nameInputSelectors.map((selector, index) =>
        page
          .locator(selector)
          .first()
          .waitFor({ state: 'visible', timeout: 10000 })
          .then(() => `register-${index}`)
      )

      const loginHeading = page.locator(loginHeadingSelector).first()
      const loginPassword = page.locator(loginPasswordSelector).first()

      // 等待其中一个关键元素出现
      const result = await Promise.race([
        ...nameInputPromises,
        loginHeading.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'login'),
        loginPassword.waitFor({ state: 'visible', timeout: 10000 }).then(() => 'login-password')
      ])

      if (result === 'login' || result === 'login-password') {
        isLoginFlow = true
        // 如果直接出现密码输入框，说明不是直接进入验证码
        isVerifyFlow = false
      } else if (result.startsWith('register-')) {
        isLoginFlow = false
      }
    } catch {
      // 如果都没找到，尝试单独检测
      try {
        // 先检测姓名输入框（尝试所有可能的选择器）
        let hasNameInput = false
        for (const selector of nameInputSelectors) {
          const isVisible = await page
            .locator(selector)
            .first()
            .isVisible()
            .catch(() => false)
          if (isVisible) {
            hasNameInput = true
            break
          }
        }

        if (hasNameInput) {
          isLoginFlow = false
        } else {
          // 再检测登录标题
          const hasLoginHeading = await page
            .locator(loginHeadingSelector)
            .first()
            .isVisible()
            .catch(() => false)

          if (hasLoginHeading) {
            isLoginFlow = true
          } else {
            // 最后检测密码输入框
            const hasLoginPassword = await page
              .locator(loginPasswordSelector)
              .first()
              .isVisible()
              .catch(() => false)

            if (hasLoginPassword) {
              isLoginFlow = true
            } else {
              // 都没有，默认为注册流程
              isLoginFlow = false
            }
          }
        }
      } catch {
        isLoginFlow = false
      }
    }

    if (isLoginFlow) {
      // ========== 登录流程（邮箱已注册）==========
      if (isVerifyFlow) {
        log('\n⚠ 检测到验证页面，邮箱已注册，直接进入验证码步骤...')
      } else {
        log('\n⚠ 检测到邮箱已注册，切换到登录流程...')
      }

      // 如果不是直接验证流程，需要先输入密码
      if (!isVerifyFlow) {
        // 步骤2(登录): 输入密码
        log('\n步骤2(登录): 输入密码...')
        const loginPasswordSelector = 'input[placeholder="Enter password"]'
        if (
          !(await waitAndFill(
            page,
            loginPasswordSelector,
            password,
            log,
            '登录密码输入框',
            30000,
            999
          ))
        ) {
          throw new Error('未找到登录密码输入框')
        }

        // 输入完成后的随机延时，模拟真实用户思考时间
        await page.waitForTimeout(randomDelay(1500, 0.5))

        // 点击继续按钮
        const loginContinueSelector = 'button[data-testid="test-primary-button"]'
        if (!(await waitAndClickWithRetry(page, loginContinueSelector, log, '登录继续按钮'))) {
          throw new Error('点击登录继续按钮失败')
        }

        // 等待页面稳定
        await waitForPageStable(page, log, '登录后的页面')
      }

      // 步骤3(登录): 等待验证码输入框出现，获取并输入验证码
      log('\n步骤3(登录): 获取并输入验证码...')
      // 登录验证码输入框选择器（支持多种 placeholder）
      const loginCodeSelectors = [
        'input[placeholder="6-digit"]',
        'input[placeholder="6 位数"]',
        'input[class*="awsui_input"][type="text"]'
      ]

      let loginCodeInput: string | null = null
      let retryCount = 0
      const maxRetries = 999 // 设置为999次，实现"无限"重试

      while (!loginCodeInput && retryCount < maxRetries) {
        for (const selector of loginCodeSelectors) {
          try {
            await page.locator(selector).first().waitFor({ state: 'visible', timeout: 10000 })
            loginCodeInput = selector
            log('✓ 登录验证码输入框已出现')
            break
          } catch {
            continue
          }
        }

        if (!loginCodeInput) {
          retryCount++
          if (retryCount < maxRetries) {
            log(`⚠ 未找到登录验证码输入框，等待后重试... (尝试 ${retryCount}/${maxRetries})`)
            await page.waitForTimeout(2000)
          }
        }
      }

      if (!loginCodeInput) {
        throw new Error('未找到登录验证码输入框')
      }

      await page.waitForTimeout(1000)

      // 如果启用了邮箱服务，自动获取验证码
      if (mailService && tempMailbox) {
        log('📧 等待验证码邮件...')
        try {
          const code = await mailService.waitForVerificationCode(
            tempMailbox.email,
            tempMailbox.password,
            5 * 60 * 1000, // 5 分钟超时
            5000 // 每 5 秒检查一次
          )
          log(`✓ 自动获取验证码: ${code}`)

          // 自动填入验证码
          await waitAndFill(page, loginCodeInput, code, log, '登录验证码', 30000, 1, false)
        } catch (error) {
          log(`⚠ 自动获取验证码失败: ${error}`)
          log('请手动输入验证码...')
          // 回退到手动输入
          if (!(await waitForManualInput(page, loginCodeInput, log, '登录验证码'))) {
            throw new Error('登录验证码输入超时或失败')
          }
        }
      } else {
        // 等待用户手动输入验证码
        log('\n步骤3(登录): 等待用户手动输入验证码...')
        if (!(await waitForManualInput(page, loginCodeInput, log, '登录验证码'))) {
          throw new Error('登录验证码输入超时或失败')
        }
      }

      // 输入完成后的随机延时，模拟真实用户思考时间
      await page.waitForTimeout(randomDelay(1500, 0.5))

      // 点击验证码确认按钮
      const loginVerifySelector = 'button[data-testid="test-primary-button"]'
      if (!(await waitAndClickWithRetry(page, loginVerifySelector, log, '登录验证码确认按钮'))) {
        throw new Error('点击登录验证码确认按钮失败')
      }

      // 等待页面稳定
      await waitForPageStable(page, log, '验证后的页面')

      // 检测是否有密码输入框（新注册流程：邮箱 → 验证码 → 密码）
      log('\n检测是否需要输入密码...')
      const passwordInputSelector = 'input[placeholder="Enter password"]'
      const confirmPasswordSelector = 'input[placeholder="Re-enter password"]'

      try {
        // 检测密码输入框是否出现
        await page
          .locator(passwordInputSelector)
          .first()
          .waitFor({ state: 'visible', timeout: 10000 })
        log('✓ 检测到密码输入框，开始输入密码...')

        // 输入密码
        if (!(await waitAndFill(page, passwordInputSelector, password, log, '密码输入框'))) {
          throw new Error('未找到密码输入框')
        }

        await page.waitForTimeout(500)

        // 输入确认密码
        if (!(await waitAndFill(page, confirmPasswordSelector, password, log, '确认密码输入框'))) {
          throw new Error('未找到确认密码输入框')
        }

        await page.waitForTimeout(1000)

        // 点击继续按钮
        const passwordContinueSelector = 'button[data-testid="test-primary-button"]'
        if (!(await waitAndClickWithRetry(page, passwordContinueSelector, log, '密码确认按钮'))) {
          throw new Error('点击密码确认按钮失败')
        }

        await page.waitForTimeout(5000)
      } catch {
        log('未检测到密码输入框，可能已完成登录')
      }
    } else {
      // ========== 注册流程（新账号）==========
      // 步骤2: 等待姓名输入框出现，输入姓名
      log('\n步骤2: 输入姓名...')

      // 尝试所有可能的姓名输入框选择器
      let nameInputFilled = false
      for (const selector of nameInputSelectors) {
        if (await waitAndFill(page, selector, randomName, log, '姓名输入框', 30000, 999)) {
          nameInputFilled = true
          break
        }
      }

      if (!nameInputFilled) {
        throw new Error('未找到姓名输入框')
      }

      // 输入完成后的随机延时，模拟真实用户思考时间
      await page.waitForTimeout(randomDelay(1500, 0.5))

      // 点击第二个继续按钮（带错误检测和自动重试）
      // 选择器: button[data-testid="signup-next-button"]
      const secondContinueSelector = 'button[data-testid="signup-next-button"]'
      if (!(await waitAndClickWithRetry(page, secondContinueSelector, log, '第二个继续按钮'))) {
        throw new Error('点击第二个继续按钮失败')
      }

      // 等待页面稳定
      await waitForPageStable(page, log, '姓名提交后的页面')

      // 步骤3: 等待验证码输入框出现，等待用户手动输入验证码
      log('\n步骤3: 等待用户手动输入验证码...')
      // 验证码输入框选择器（支持多种 placeholder）
      const codeInputSelectors = [
        'input[placeholder="6-digit"]',
        'input[placeholder="6 位数"]',
        'input[class*="awsui_input"][type="text"]'
      ]

      let codeInputSelector: string | null = null
      let codeRetryCount = 0
      const codeMaxRetries = 999 // 设置为999次，实现"无限"重试

      while (!codeInputSelector && codeRetryCount < codeMaxRetries) {
        for (const selector of codeInputSelectors) {
          try {
            await page.locator(selector).first().waitFor({ state: 'visible', timeout: 10000 })
            codeInputSelector = selector
            log('✓ 验证码输入框已出现')
            break
          } catch {
            continue
          }
        }

        if (!codeInputSelector) {
          codeRetryCount++
          if (codeRetryCount < codeMaxRetries) {
            log(`⚠ 未找到验证码输入框，等待后重试... (尝试 ${codeRetryCount}/${codeMaxRetries})`)
            await page.waitForTimeout(2000)
          }
        }
      }

      if (!codeInputSelector) {
        throw new Error('未找到验证码输入框')
      }

      // 如果启用了邮箱服务，自动获取验证码
      if (mailService && tempMailbox) {
        log('📧 等待验证码邮件...')
        try {
          const code = await mailService.waitForVerificationCode(
            tempMailbox.email,
            tempMailbox.password,
            5 * 60 * 1000, // 5 分钟超时
            5000 // 每 5 秒检查一次
          )
          log(`✓ 自动获取验证码: ${code}`)

          // 自动填入验证码
          await waitAndFill(page, codeInputSelector, code, log, '验证码', 30000, 1, false)
        } catch (error) {
          log(`⚠ 自动获取验证码失败: ${error}`)
          log('请手动输入验证码...')
          // 回退到手动输入
          if (!(await waitForManualInput(page, codeInputSelector, log, '验证码'))) {
            throw new Error('验证码输入超时或失败')
          }
        }
      } else {
        // 等待用户手动输入验证码
        if (!(await waitForManualInput(page, codeInputSelector, log, '验证码'))) {
          throw new Error('验证码输入超时或失败')
        }
      }

      // 输入完成后的随机延时，模拟真实用户思考时间
      await page.waitForTimeout(randomDelay(1500, 0.5))

      // 点击 Continue 按钮（带错误检测和自动重试）
      // 选择器: button[data-testid="email-verification-verify-button"]
      const verifyButtonSelector = 'button[data-testid="email-verification-verify-button"]'
      if (!(await waitAndClickWithRetry(page, verifyButtonSelector, log, 'Continue 按钮'))) {
        throw new Error('点击 Continue 按钮失败')
      }

      // 等待页面稳定
      await waitForPageStable(page, log, '验证码确认后的页面')

      // 调试：输出页面上所有的 input 元素信息（步骤4之前）
      // 步骤4: 等待密码输入框出现，输入密码
      log('\n步骤4: 输入密码...')

      // 添加重试机制，增加重试次数以确保能检测到密码输入框
      let firstPasswordInput: any = null
      let confirmPasswordInput: any = null
      let retryCount = 0
      const maxRetries = 999 // 设置为999次，实现"无限"重试

      while (retryCount < maxRetries) {
        // 等待密码输入框加载完成，增加等待时间
        await page.waitForTimeout(randomDelay(4000, 0.5))

        // 获取所有密码输入框
        const allPasswordInputs = await page.locator('input[type="password"]').all()

        // 区分第一个密码输入框和确认密码输入框
        // 确认密码输入框的特征：placeholder 包含 "nouveau"、"erneut"、"re-enter"、"repeat"、"confirm" 等
        const confirmKeywords = ['nouveau', 'erneut', 're-enter', 'repeat', 'confirm', 'again']

        firstPasswordInput = null
        confirmPasswordInput = null

        for (const input of allPasswordInputs) {
          const placeholder = await input.getAttribute('placeholder').catch(() => '')
          const isVisible = await input.isVisible().catch(() => false)

          if (!isVisible) continue

          const placeholderLower = (placeholder || '').toLowerCase()
          const isConfirm = confirmKeywords.some((keyword) => placeholderLower.includes(keyword))

          if (isConfirm) {
            confirmPasswordInput = input
            log(`[调试] 识别为确认密码输入框: placeholder="${placeholder}"`)
          } else {
            if (!firstPasswordInput) {
              firstPasswordInput = input
              log(`[调试] 识别为第一个密码输入框: placeholder="${placeholder}"`)
            }
          }
        }

        // 如果找到了第一个密码输入框和确认密码输入框，跳出重试循环
        if (firstPasswordInput && confirmPasswordInput) {
          break
        }

        // 如果没找到，增加重试计数
        retryCount++
        if (retryCount < maxRetries) {
          if (!firstPasswordInput) {
            log(`⚠ 未找到第一个密码输入框，等待后重试...`)
          } else if (!confirmPasswordInput) {
            log(`⚠ 未找到确认密码输入框，等待后重试...`)
          }
        }
      }

      // 填充第一个密码输入框
      if (firstPasswordInput) {
        await firstPasswordInput.fill(password)
        log('✓ 已输入第一个密码输入框')
      } else {
        throw new Error(`未找到第一个密码输入框（已重试${maxRetries}次）`)
      }

      await page.waitForTimeout(500)

      // 填充确认密码输入框
      if (confirmPasswordInput) {
        await confirmPasswordInput.fill(password)
        log('✓ 已输入确认密码输入框')
      } else {
        throw new Error(`未找到确认密码输入框（已重试${maxRetries}次）`)
      }

      // 输入完成后的随机延时，模拟真实用户思考时间
      await page.waitForTimeout(randomDelay(1500, 0.5))

      // 点击第三个继续按钮（带错误检测和自动重试）
      // 选择器: button[data-testid="test-primary-button"]
      const thirdContinueSelector = 'button[data-testid="test-primary-button"]'
      if (!(await waitAndClickWithRetry(page, thirdContinueSelector, log, '第三个继续按钮'))) {
        throw new Error('点击第三个继续按钮失败')
      }

      // 等待页面稳定
      await waitForPageStable(page, log, '密码提交后的页面')
    }

    // 步骤5: 获取 SSO Token（登录和注册流程共用）
    log('\n步骤5: 获取 SSO Token...')
    let ssoToken: string | null = null

    for (let i = 0; i < 999; i++) {
      // 设置为999次，实现"无限"重试
      const cookies = await context.cookies()
      const ssoCookie = cookies.find((c) => c.name === 'x-amz-sso_authn')
      if (ssoCookie) {
        ssoToken = ssoCookie.value
        log(`✓ 成功获取 SSO Token (x-amz-sso_authn)!`)
        log(`  成功获取后延迟2s`)
        await page.waitForTimeout(randomDelay(2000))

        // 调试：打印页面上所有的按钮信息
        log('\n[调试] 检测页面上的所有按钮...')
        try {
          const buttons = await page.locator('button').all()
          log(`[调试] 找到 ${buttons.length} 个按钮:`)

          const visibleButtons: any[] = []
          for (let i = 0; i < buttons.length; i++) {
            const button = buttons[i]
            const text = await button.textContent().catch(() => null)
            const dataTestId = await button.getAttribute('data-testid').catch(() => null)
            const className = await button.getAttribute('class').catch(() => null)
            const id = await button.getAttribute('id').catch(() => null)
            const isVisible = await button.isVisible().catch(() => false)

            log(
              `[调试] Button ${i + 1}: text="${text}", id="${id}", class="${className}", data-testid="${dataTestId}", visible=${isVisible}`
            )

            if (isVisible) {
              visibleButtons.push({ button, text, dataTestId, className, id })
            }
          }

          // 等待并点击确认按钮
          if (visibleButtons.length > 0) {
            log(`\n找到 ${visibleButtons.length} 个可见按钮，尝试点击确认按钮...`)

            // 如果只有一个可见按钮，直接点击
            if (visibleButtons.length === 1) {
              const { button, text } = visibleButtons[0]
              log(`点击唯一的可见按钮: "${text}"`)
              await button.click()
              log('✓ 已点击确认按钮')
              await page.waitForTimeout(randomDelay(2000))
            } else {
              // 如果有多个按钮，尝试根据文本内容判断
              const confirmKeywords = [
                '确认',
                'confirm',
                'continue',
                '完成',
                'finish',
                'done',
                'ok',
                'allow',
                '允许'
              ]
              let clicked = false

              for (const { button, text } of visibleButtons) {
                const textLower = (text || '').toLowerCase()
                if (confirmKeywords.some((keyword) => textLower.includes(keyword))) {
                  log(`点击确认按钮: "${text}"`)
                  await button.click()
                  log('✓ 已点击确认按钮')
                  await page.waitForTimeout(randomDelay(2000))
                  clicked = true
                  break
                }
              }

              if (!clicked) {
                log('⚠ 未找到明确的确认按钮，点击第一个可见按钮')
                await visibleButtons[0].button.click()
                log('✓ 已点击按钮')
                await page.waitForTimeout(randomDelay(2000))
              }
            }
          } else {
            log('⚠ 未找到可见的按钮')
          }
        } catch (e) {
          log(`[调试] 获取或点击按钮失败: ${e}`)
        }

        break
      }
      log(`等待 SSO Token... (${i + 1}/999)`)
      await page.waitForTimeout(randomDelay(1000))
    }

    if (!ssoToken) {
      await browser.close()
      browser = null
      throw new Error('未能获取 SSO Token，可能操作未完成')
    }

    // 如果启用了测试模式，测试登录流程判断逻辑
    if (testLoginDetection) {
      log('\n========== 开始测试登录流程判断逻辑 ==========')
      log('保持浏览器打开，重新访问注册页面（不清除浏览器数据）...')

      try {
        // 生成新的设备授权码用于第二次注册
        const newUserCode = generateUserCode()
        const newRegisterUrl = `https://view.awsapps.com/start/#/device?user_code=${newUserCode}`
        log(`生成新的设备授权码: ${newUserCode}`)

        // 重新访问注册页面（保留登录状态）
        log(`访问注册页面: ${newRegisterUrl}`)
        await page.goto(newRegisterUrl, { waitUntil: 'networkidle', timeout: 60000 })
        log('✓ 重新加载注册页面完成')
        await page.waitForTimeout(5000) // 等待页面自动跳转

        // 注释掉邮箱输入和点击继续的步骤，因为页面会自动识别已登录状态
        // log(`输入相同的邮箱: ${email}`)
        // if (!(await waitAndFill(page, emailInputSelector, email, log, '邮箱输入框'))) {
        //   throw new Error('未找到邮箱输入框')
        // }
        // await page.waitForTimeout(1000)
        //
        // log('点击继续按钮...')
        // if (!(await waitAndClickWithRetry(page, firstContinueSelector, log, '继续按钮'))) {
        //   throw new Error('点击继续按钮失败')
        // }
        // await page.waitForTimeout(3000)

        // 检测是否正确识别为登录流程
        log('检测页面类型...')
        const testLoginHeading = await page
          .locator(loginHeadingSelector)
          .first()
          .isVisible()
          .catch(() => false)

        const testLoginPassword = await page
          .locator(loginPasswordSelector)
          .first()
          .isVisible()
          .catch(() => false)

        let testNameInput = false
        for (const selector of nameInputSelectors) {
          const isVisible = await page
            .locator(selector)
            .first()
            .isVisible()
            .catch(() => false)
          if (isVisible) {
            testNameInput = true
            break
          }
        }

        // 判断测试结果
        if (testLoginHeading || testLoginPassword) {
          log('✓ 测试成功！正确识别为登录流程')
          log(`  - 检测到登录标题: ${testLoginHeading}`)
          log(`  - 检测到密码输入框: ${testLoginPassword}`)
        } else if (testNameInput) {
          log('✗ 测试失败！错误识别为注册流程（检测到姓名输入框）')
        } else {
          log('⚠ 测试结果不确定：未检测到明确的登录或注册标识')
        }

        log('\n========== 测试完成 ==========')
      } catch (testError) {
        log(`⚠ 测试过程出错: ${testError}`)
      }
    }

    // 关闭浏览器（如果不需要保持打开）
    if (!keepBrowserOpen) {
      await browser.close()
      browser = null
      log('✓ 浏览器已关闭')
    } else {
      log('⚠ 浏览器保持打开状态，请手动关闭')
    }

    log('\n========== AWS Builder ID 注册完成 ==========')
    log(`SSO Token: ${ssoToken}`)

    // 步骤6: 执行 SSO 设备授权流程，获取 Access Token
    log('\n========== 开始 SSO 设备授权流程 ==========')
    const ssoResult = await ssoDeviceAuth(ssoToken, 'us-east-1', log)

    if (!ssoResult.success) {
      log(`\n✗ SSO 设备授权失败: ${ssoResult.error}`)
      return { success: false, error: ssoResult.error }
    }

    log('\n========== 操作成功! ==========')
    log(`Access Token: ${ssoResult.accessToken?.substring(0, 30)}...`)

    // 清理临时邮箱
    if (mailService && tempMailbox) {
      try {
        await mailService.deleteMailbox(tempMailbox.email)
        log(`✓ 临时邮箱已清理: ${tempMailbox.email}`)
      } catch (error) {
        log(`⚠ 清理临时邮箱失败: ${error}`)
      }
    }

    return {
      success: true,
      ssoToken,
      name: randomName,
      accessToken: ssoResult.accessToken,
      refreshToken: ssoResult.refreshToken
    }
  } catch (error) {
    log(`\n✗ 注册失败: ${error}`)
    if (browser) {
      try {
        await browser.close()
      } catch {}
    }

    // 清理临时邮箱
    if (mailService && tempMailbox) {
      try {
        await mailService.deleteMailbox(tempMailbox.email)
        log(`✓ 临时邮箱已清理: ${tempMailbox.email}`)
      } catch (cleanupError) {
        log(`⚠ 清理临时邮箱失败: ${cleanupError}`)
      }
    }

    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
