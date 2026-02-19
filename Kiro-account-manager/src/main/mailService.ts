/**
 * 邮箱服务模块
 * 用于自动创建临时邮箱和获取验证码
 */

// 邮箱服务配置
export interface MailServiceConfig {
  enabled: boolean // 是否启用自动邮箱服务
  apiUrl: string // API 基础地址，如 https://yourdomain.com:8443
  apiKey: string // API 密钥
  mailDomain: string // 邮箱域名，如 yourdomain.com
}

// 邮件信息
interface EmailMessage {
  uid: number
  seq: number
  date: string
  from: Array<{ name: string; address: string }>
  to: Array<{ name: string; address: string }>
  subject: string
  flags: string[]
  size: number
}

// 邮件详情
interface EmailDetail {
  uid: number
  messageId: string
  date: string
  from: Array<{ name: string; address: string }>
  to: Array<{ name: string; address: string }>
  cc: Array<{ name: string; address: string }> | null
  subject: string
  text: string | null
  html: string | false
  attachments: Array<{
    filename: string
    contentType: string
    size: number
  }>
}

// AWS 验证码发件人
const AWS_SENDERS = [
  'no-reply@signin.aws',
  'no-reply@login.awsapps.com',
  'noreply@amazon.com',
  'account-update@amazon.com',
  'no-reply@aws.amazon.com',
  'noreply@aws.amazon.com'
]

// 验证码正则表达式
const CODE_PATTERNS = [
  /(?:verification\s*code|验证码|Your code is|code is)[：:\s]*(\d{6})/gi,
  /(?:is|为)[：:\s]*(\d{6})\b/gi,
  /^\s*(\d{6})\s*$/gm,
  />\s*(\d{6})\s*</g
]

/**
 * 从文本中提取验证码
 */
function extractCode(text: string): string | null {
  if (!text) return null

  for (const pattern of CODE_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1]
      if (code && /^\d{6}$/.test(code)) {
        const start = Math.max(0, match.index - 20)
        const end = Math.min(text.length, match.index + match[0].length + 20)
        const context = text.slice(start, end)

        // 排除颜色代码和其他干扰
        if (context.includes('#' + code)) continue
        if (/color[:\s]*[^;]*\d{6}/i.test(context)) continue
        if (/rgb|rgba|hsl/i.test(context)) continue
        if (/\d{7,}/.test(context)) continue

        return code
      }
    }
  }
  return null
}

/**
 * 邮箱服务类
 */
export class MailService {
  private config: MailServiceConfig

  constructor(config: MailServiceConfig) {
    this.config = config
  }

  /**
   * 检查服务是否可用
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.apiUrl}/health`)
      const data = await response.json()
      return data.status === 'ok'
    } catch {
      return false
    }
  }

  /**
   * 创建临时邮箱
   * @param name 邮箱用户名（可选，不提供则自动生成）
   * @returns 完整邮箱地址和密码
   */
  async createMailbox(name?: string): Promise<{ email: string; password: string }> {
    if (!this.config.enabled) {
      throw new Error('邮箱服务未启用')
    }

    // 生成随机用户名（如果未提供）
    const username = name || `temp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    const password = `Pass_${Math.random().toString(36).substring(2, 15)}!`

    const response = await fetch(`${this.config.apiUrl}/api/mailboxes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey
      },
      body: JSON.stringify({ name: username, password })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`创建邮箱失败: ${error.error || response.statusText}`)
    }

    const data = await response.json()
    return {
      email: data.email,
      password
    }
  }

  /**
   * 获取邮箱列表
   */
  async listMailboxes(): Promise<string[]> {
    const response = await fetch(`${this.config.apiUrl}/api/mailboxes`, {
      headers: {
        'x-api-key': this.config.apiKey
      }
    })

    if (!response.ok) {
      throw new Error(`获取邮箱列表失败: ${response.statusText}`)
    }

    const data = await response.json()
    return data.mailboxes.map((m: { email: string }) => m.email)
  }

  /**
   * 删除邮箱
   */
  async deleteMailbox(email: string): Promise<void> {
    const response = await fetch(`${this.config.apiUrl}/api/mailboxes/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: {
        'x-api-key': this.config.apiKey
      }
    })

    if (!response.ok) {
      throw new Error(`删除邮箱失败: ${response.statusText}`)
    }
  }

  /**
   * 获取收件箱邮件列表
   */
  async getMessages(email: string, password: string, limit: number = 10): Promise<EmailMessage[]> {
    const response = await fetch(
      `${this.config.apiUrl}/api/mailboxes/${encodeURIComponent(email)}/messages?limit=${limit}&offset=0`,
      {
        headers: {
          'x-api-key': this.config.apiKey,
          'x-mailbox-password': password
        }
      }
    )

    if (!response.ok) {
      throw new Error(`获取邮件列表失败: ${response.statusText}`)
    }

    const data = await response.json()
    return data.messages
  }

  /**
   * 获取单封邮件详情
   */
  async getMessageDetail(email: string, password: string, uid: number): Promise<EmailDetail> {
    const response = await fetch(
      `${this.config.apiUrl}/api/mailboxes/${encodeURIComponent(email)}/messages/${uid}`,
      {
        headers: {
          'x-api-key': this.config.apiKey,
          'x-mailbox-password': password
        }
      }
    )

    if (!response.ok) {
      throw new Error(`获取邮件详情失败: ${response.statusText}`)
    }

    return await response.json()
  }

  /**
   * 等待并获取 AWS 验证码
   * @param email 邮箱地址
   * @param password 邮箱密码
   * @param maxWaitTime 最大等待时间（毫秒），默认 5 分钟
   * @param checkInterval 检查间隔（毫秒），默认 5 秒
   * @returns 验证码
   */
  async waitForVerificationCode(
    email: string,
    password: string,
    maxWaitTime: number = 5 * 60 * 1000,
    checkInterval: number = 5000
  ): Promise<string> {
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // 获取最新的邮件列表
        const messages = await this.getMessages(email, password, 10)

        // 查找来自 AWS 的邮件
        for (const message of messages) {
          const fromAddress = message.from[0]?.address.toLowerCase() || ''
          const isFromAWS = AWS_SENDERS.some(sender => fromAddress.includes(sender.toLowerCase()))

          if (isFromAWS) {
            // 获取邮件详情
            const detail = await this.getMessageDetail(email, password, message.uid)

            // 从邮件内容中提取验证码
            const text = detail.text || ''
            const html = typeof detail.html === 'string' ? detail.html : ''
            const fullText = `${text}\n${html}`

            const code = extractCode(fullText)
            if (code) {
              console.log(`[MailService] 找到验证码: ${code}`)
              return code
            }
          }
        }
      } catch (error) {
        console.error('[MailService] 检查邮件时出错:', error)
      }

      // 等待一段时间后再次检查
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    throw new Error('等待验证码超时')
  }
}
