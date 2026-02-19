import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Play,
  Square,
  Upload,
  Trash2,
  Copy,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Mail,
  Key,
  RefreshCw,
  AlertCircle,
  Terminal,
  Clipboard,
  Settings,
  List,
  BarChart3,
  Layers,
  Send,
  Eye,
  EyeOff
} from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Badge } from '../ui/badge'
import { useAccountsStore } from '@/store/accounts'
import { useAutoRegisterStore, type RegisterAccount } from '@/store/autoRegister'
import { v4 as uuidv4 } from 'uuid'

type TabType = 'config' | 'accounts' | 'logs' | 'stats'

export function AutoRegisterPage() {
  const [activeTab, setActiveTab] = useState<TabType>('config')
  const [inputText, setInputText] = useState('')
  const [registerCount, setRegisterCount] = useState<number | ''>(() => {
    // 从 localStorage 恢复连续注册次数
    const saved = localStorage.getItem('autoRegisterCount')
    return saved ? parseInt(saved) : 1
  })
  const logEndRef = useRef<HTMLDivElement>(null)
  
  // 使用全局 store
  const {
    accounts,
    isRunning,
    logs,
    concurrency,
    addAccounts,
    clearAccounts,
    updateAccountStatus,
    addLog,
    clearLogs,
    setIsRunning,
    setConcurrency,
    requestStop,
    resetStop,
    getStats
  } = useAutoRegisterStore()
  
  const { addAccount, saveToStorage, proxyUrl, setProxy, accounts: existingAccounts, mailServiceConfig, setMailServiceConfig, deviceSyncConfig, setDeviceSyncConfig, syncToServer, autoRegisterAndLogin } = useAccountsStore()

  // 设备同步相关状态
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ success: boolean; synced?: number; skipped?: number; message?: string; error?: string } | null>(null)
  const [isGettingToken, setIsGettingToken] = useState(false)
  const [showToken, setShowToken] = useState(false)

  // 保存连续注册次数到 localStorage
  useEffect(() => {
    if (typeof registerCount === 'number') {
      localStorage.setItem('autoRegisterCount', registerCount.toString())
    }
  }, [registerCount])

  // 检查邮箱是否已存在
  const isEmailExists = useCallback((email: string): boolean => {
    const emailLower = email.toLowerCase()
    return Array.from(existingAccounts.values()).some(
      acc => acc.email.toLowerCase() === emailLower
    )
  }, [existingAccounts])

  // 监听来自主进程的实时日志
  useEffect(() => {
    const unsubscribe = window.api.onAutoRegisterLog((data) => {
      addLog(`[${data.email.split('@')[0]}] ${data.message}`)
    })
    return () => unsubscribe()
  }, [addLog])

  // 自动滚动到日志底部
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const parseAccounts = (text: string): RegisterAccount[] => {
    const lines = text.trim().split('\n')
    const parsed: RegisterAccount[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      // 只需要邮箱
      if (trimmed.includes('@')) {
        const email = trimmed.trim()
        // 检查是否已存在
        const exists = isEmailExists(email)
        parsed.push({
          id: uuidv4(),
          email,
          status: exists ? 'exists' : 'pending'
        })
      }
    }

    return parsed
  }

  const handleImport = () => {
    const parsed = parseAccounts(inputText)
    if (parsed.length === 0) {
      alert('没有找到有效的邮箱账号')
      return
    }
    const existsCount = parsed.filter(a => a.status === 'exists').length
    addAccounts(parsed)
    setInputText('')
    addLog(`导入了 ${parsed.length} 个邮箱账号${existsCount > 0 ? `，其中 ${existsCount} 个已存在` : ''}`)
  }

  const handleImportFile = async () => {
    try {
      const result = await window.api.openFile({
        filters: [{ name: '文本文件', extensions: ['txt'] }]
      })

      if (result && !result.canceled && result.filePaths.length > 0) {
        // 读取文件内容
        const filePath = result.filePaths[0]
        const fileResult = await window.api.readFile(filePath)

        if (fileResult.success && fileResult.content) {
          const parsed = parseAccounts(fileResult.content)
          if (parsed.length > 0) {
            const existsCount = parsed.filter(a => a.status === 'exists').length
            addAccounts(parsed)
            addLog(`从文件导入了 ${parsed.length} 个邮箱账号${existsCount > 0 ? `，其中 ${existsCount} 个已存在` : ''}`)
          }
        }
      }
    } catch (error) {
      addLog(`导入文件失败: ${error}`)
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setInputText(text)
        addLog(`已从剪贴板粘贴 ${text.split('\n').length} 行内容`)
      } else {
        addLog('剪贴板为空')
      }
    } catch (error) {
      addLog(`粘贴失败: ${error}`)
      alert('粘贴失败，请确保已授予剪贴板访问权限，或使用 Ctrl+V 快捷键')
    }
  }

  const handleClear = () => {
    if (isRunning) {
      alert('请先停止注册')
      return
    }
    clearAccounts()
  }

  // 使用 SSO Token 导入账号
  const importWithSsoToken = async (account: RegisterAccount, ssoToken: string, name: string) => {
    try {
      addLog(`[${account.email}] 正在通过 SSO Token 导入账号...`)
      
      const result = await window.api.importFromSsoToken(ssoToken, 'us-east-1')
      
      if (result.success && result.data) {
        const { data } = result
        
        // 确定 idp 类型
        const idpValue = data.idp as 'Google' | 'Github' | 'BuilderId' | 'AWSIdC' | 'Internal' || 'BuilderId'
        
        // 确定订阅类型
        let subscriptionType: 'Free' | 'Pro' | 'Pro_Plus' | 'Enterprise' | 'Teams' = 'Free'
        const subType = data.subscriptionType?.toUpperCase() || ''
        if (subType.includes('PRO_PLUS') || subType.includes('PRO+')) {
          subscriptionType = 'Pro_Plus'
        } else if (subType.includes('PRO')) {
          subscriptionType = 'Pro'
        } else if (subType.includes('ENTERPRISE')) {
          subscriptionType = 'Enterprise'
        } else if (subType.includes('TEAMS')) {
          subscriptionType = 'Teams'
        }
        
        addAccount({
          email: data.email || account.email,
          nickname: name,
          idp: idpValue,
          credentials: {
            accessToken: data.accessToken,
            csrfToken: '',
            refreshToken: data.refreshToken,
            clientId: data.clientId,
            clientSecret: data.clientSecret,
            region: data.region || 'us-east-1',
            authMethod: 'IdC',
            expiresAt: Date.now() + (data.expiresIn || 3600) * 1000
          },
          subscription: { 
            type: subscriptionType,
            title: data.subscriptionTitle
          },
          usage: data.usage ? {
            current: data.usage.current,
            limit: data.usage.limit,
            percentUsed: data.usage.limit > 0 ? (data.usage.current / data.usage.limit) * 100 : 0,
            lastUpdated: Date.now()
          } : { current: 0, limit: 50, percentUsed: 0, lastUpdated: Date.now() },
          tags: [],
          status: 'active',
          lastUsedAt: Date.now()
        })
        
        saveToStorage()
        addLog(`[${account.email}] ✓ 已成功添加到账号管理器`)
        return true
      } else {
        addLog(`[${account.email}] ✗ SSO Token 导入失败: ${result.error?.message || '未知错误'}`)
        return false
      }
    } catch (error) {
      addLog(`[${account.email}] ✗ 导入出错: ${error}`)
      return false
    }
  }

  // 单个账号注册任务（使用全局 store 的 shouldStop）
  const registerSingleAccount = async (account: RegisterAccount): Promise<void> => {
    // 检查全局停止标志
    if (useAutoRegisterStore.getState().shouldStop) return
    if (account.status === 'success' || account.status === 'exists') return
    
    try {
      updateAccountStatus(account.id, { status: 'registering' })
      const displayEmail = account.email === '(自动生成)' ? '自动邮箱' : account.email
      addLog(`[${displayEmail}] 开始注册...`)

      // 调用主进程的自动注册功能
      const result = await window.api.autoRegisterAWS({
        email: mailServiceConfig.enabled ? null : account.email,
        proxyUrl: proxyUrl || undefined,
        mailServiceConfig: mailServiceConfig.enabled ? mailServiceConfig : undefined
      })

      if (result.success && result.ssoToken) {
        updateAccountStatus(account.id, {
          status: 'success',
          ssoToken: result.ssoToken,
          awsName: result.awsName
        })
        addLog(`[${displayEmail}] ✓ 注册成功!`)

        // 使用 SSO Token 导入账号
        await importWithSsoToken(account, result.ssoToken, result.awsName || account.email.split('@')[0])

      } else {
        updateAccountStatus(account.id, {
          status: 'failed',
          error: result.error || '注册失败'
        })
        addLog(`[${displayEmail}] ✗ 注册失败: ${result.error}`)
      }

    } catch (error) {
      const displayEmail = account.email === '(自动生成)' ? '自动邮箱' : account.email
      updateAccountStatus(account.id, {
        status: 'failed',
        error: String(error)
      })
      addLog(`[${displayEmail}] ✗ 错误: ${error}`)
    }
  }

  const startRegistration = async () => {
    // 如果启用了邮箱服务，清除之前的虚拟账号并创建新的
    if (mailServiceConfig.enabled) {
      // 清除所有虚拟账号（邮箱为 "(自动生成)" 的账号）
      const nonVirtualAccounts = accounts.filter(a => a.email !== '(自动生成)')
      if (nonVirtualAccounts.length < accounts.length) {
        // 有虚拟账号，清除它们
        clearAccounts()
        // 如果有非虚拟账号，重新添加
        if (nonVirtualAccounts.length > 0) {
          addAccounts(nonVirtualAccounts)
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      // 根据注册次数创建多个虚拟账号
      const virtualAccounts: RegisterAccount[] = []
      const count = typeof registerCount === 'number' ? registerCount : 1
      for (let i = 0; i < count; i++) {
        virtualAccounts.push({
          id: uuidv4(),
          email: '(自动生成)',
          status: 'pending'
        })
      }
      addAccounts(virtualAccounts)
      // 等待状态更新
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // 只注册待处理的账号，跳过已存在、已成功和已失败的账号
    const pendingAccounts = useAutoRegisterStore.getState().accounts.filter(a => a.status === 'pending')

    if (pendingAccounts.length === 0) {
      alert('没有需要注册的账号（已存在、已成功或已失败的账号会被跳过）')
      return
    }

    setIsRunning(true)
    resetStop()
    addLog(`========== 开始批量注册 (并发数: ${concurrency}) ==========`)
    addLog(`待注册: ${pendingAccounts.length} 个，已跳过: ${accounts.length - pendingAccounts.length} 个`)

    // 并发执行注册任务
    const runConcurrent = async () => {
      const queue = [...pendingAccounts]
      const running: Promise<void>[] = []

      while (queue.length > 0 || running.length > 0) {
        // 检查全局停止标志
        if (useAutoRegisterStore.getState().shouldStop) {
          addLog('用户停止了注册')
          break
        }

        // 填充到并发数
        while (queue.length > 0 && running.length < concurrency) {
          const account = queue.shift()!
          const task = registerSingleAccount(account).then(() => {
            // 任务完成后从 running 中移除
            const index = running.indexOf(task)
            if (index > -1) running.splice(index, 1)
          })
          running.push(task)
        }

        // 等待任意一个任务完成
        if (running.length > 0) {
          await Promise.race(running)
        }
      }
    }

    await runConcurrent()

    setIsRunning(false)
    const stats = getStats()
    addLog(`========== 注册完成: 成功 ${stats.success}，失败 ${stats.failed} ==========`)
  }

  const stopRegistration = () => {
    requestStop()
    addLog('正在停止注册...')
  }

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token)
  }

  // 设备同步处理函数
  const handleSyncToServer = async () => {
    if (!deviceSyncConfig.enabled) {
      alert('请先启用设备同步')
      return
    }

    if (!deviceSyncConfig.serverUrl || !deviceSyncConfig.authToken) {
      alert('请先配置同步服务器地址和认证 Token')
      return
    }

    if (!deviceSyncConfig.deviceId || !deviceSyncConfig.deviceName) {
      alert('请先配置设备信息')
      return
    }

    const accountList = Array.from(existingAccounts.values())
    if (accountList.length === 0) {
      alert('没有可同步的账号')
      return
    }

    if (!confirm(`确定要将 ${accountList.length} 个账号同步到服务器吗？`)) {
      return
    }

    setIsSyncing(true)
    setSyncResult(null)

    try {
      const result = await syncToServer()
      setSyncResult(result)

      if (result.success) {
        alert(result.message || `同步成功！已同步 ${result.synced} 个账号`)
      } else {
        alert(`同步失败: ${result.error}`)
      }
    } catch (error) {
      setSyncResult({
        success: false,
        error: error instanceof Error ? error.message : '同步失败'
      })
      alert(`同步出错: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setIsSyncing(false)
    }
  }

  // 自动获取 Token
  const handleGetToken = async () => {
    if (!deviceSyncConfig.serverUrl) {
      alert('请先配置同步服务器地址')
      return
    }

    setIsGettingToken(true)

    try {
      // 先获取设备信息
      const deviceInfo = await window.api.getDeviceInfo()

      // 更新设备信息
      setDeviceSyncConfig({
        deviceId: deviceInfo.deviceId,
        deviceName: deviceInfo.deviceName,
        deviceType: deviceInfo.deviceType as 'desktop' | 'mobile' | 'tablet'
      })

      // 获取 Token
      const result = await autoRegisterAndLogin()

      if (result.success) {
        alert('✓ Token 和设备信息获取成功！已自动保存')
      } else {
        alert(`✗ Token 获取失败: ${result.error}`)
      }
    } catch (error) {
      alert(`✗ 获取出错: ${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setIsGettingToken(false)
    }
  }

  const getStatusBadge = (status: RegisterAccount['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />等待</Badge>
      case 'exists':
        return <Badge variant="outline" className="text-orange-500 border-orange-500"><AlertCircle className="w-3 h-3 mr-1" />已存在</Badge>
      case 'registering':
        return <Badge variant="default"><Loader2 className="w-3 h-3 mr-1 animate-spin" />注册中</Badge>
      case 'getting_code':
        return <Badge variant="default"><Mail className="w-3 h-3 mr-1" />获取验证码</Badge>
      case 'success':
        return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />成功</Badge>
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />失败</Badge>
    }
  }


  const stats = getStats()

  const tabs = [
    { id: 'config' as TabType, label: '配置', icon: Settings },
    { id: 'accounts' as TabType, label: '账号列表', icon: List },
    { id: 'logs' as TabType, label: '运行日志', icon: Terminal },
    { id: 'stats' as TabType, label: '统计', icon: BarChart3 }
  ]

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">AWS 自动注册</h1>
          <p className="text-sm text-muted-foreground">
            自动注册 AWS Builder ID 并添加到账号管理器
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {isRunning ? (
            <Button variant="destructive" onClick={stopRegistration}>
              <Square className="w-4 h-4 mr-2" />
              停止
            </Button>
          ) : (
            <Button
              onClick={startRegistration}
              disabled={!mailServiceConfig.enabled && accounts.length === 0}
            >
              <Play className="w-4 h-4 mr-2" />
              开始注册
            </Button>
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b">
        <nav className="flex gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 border-b-2 transition-colors text-sm font-medium ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'config' && (
        <div className="space-y-3">
          {/* 邮箱服务配置 */}
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Mail className="w-4 h-4" />
                  自动邮箱服务
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {mailServiceConfig.enabled ? '已启用' : '已禁用'}
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mailServiceConfig.enabled}
                      onChange={(e) => setMailServiceConfig({ enabled: e.target.checked })}
                      disabled={isRunning}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
              </div>
            </CardHeader>
            {mailServiceConfig.enabled && (
              <CardContent className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs font-medium mb-1 block">API 地址</label>
                    <input
                      type="text"
                      placeholder="https://yourdomain.com:8443"
                      value={mailServiceConfig.apiUrl}
                      onChange={(e) => setMailServiceConfig({ apiUrl: e.target.value })}
                      disabled={isRunning}
                      className="w-full px-2 py-1.5 border rounded bg-background text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">API 密钥</label>
                    <input
                      type="password"
                      placeholder="your-api-key"
                      value={mailServiceConfig.apiKey}
                      onChange={(e) => setMailServiceConfig({ apiKey: e.target.value })}
                      disabled={isRunning}
                      className="w-full px-2 py-1.5 border rounded bg-background text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">邮箱域名</label>
                    <input
                      type="text"
                      placeholder="yourdomain.com"
                      value={mailServiceConfig.mailDomain}
                      onChange={(e) => setMailServiceConfig({ mailDomain: e.target.value })}
                      disabled={isRunning}
                      className="w-full px-2 py-1.5 border rounded bg-background text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium mb-1 block">连续注册次数 (1-100)</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      placeholder="1"
                      value={registerCount}
                      onChange={(e) => {
                        const val = e.target.value
                        if (val === '') {
                          setRegisterCount('' as any)
                        } else {
                          const num = parseInt(val)
                          if (!isNaN(num)) {
                            setRegisterCount(Math.max(1, Math.min(100, num)))
                          }
                        }
                      }}
                      onBlur={(e) => {
                        if (e.target.value === '') {
                          setRegisterCount(1)
                        }
                      }}
                      disabled={isRunning}
                      className="w-full px-2 py-1.5 border rounded bg-background text-xs"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const result = await window.api.testMailService(mailServiceConfig)
                          if (result.success) {
                            alert('✓ 邮箱服务连接成功')
                          } else {
                            alert(`✗ 连接失败: ${result.error}`)
                          }
                        } catch (error) {
                          alert(`✗ 测试出错: ${error}`)
                        }
                      }}
                      disabled={isRunning || !mailServiceConfig.apiUrl || !mailServiceConfig.apiKey}
                      className="h-7 text-xs px-2"
                    >
                      <CheckCircle className="w-3 h-3 mr-1" />
                      测试连接
                    </Button>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* 基础配置和邮箱账号 - 左右布局 */}
          <div className="grid grid-cols-2 gap-3">
            {/* 左侧：基础配置 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Settings className="w-4 h-4" />
                  基础配置
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <label className="text-xs font-medium mb-1 block">代理地址</label>
                  <input
                    type="text"
                    placeholder="http://127.0.0.1:7890"
                    value={proxyUrl}
                    onChange={(e) => setProxy(true, e.target.value)}
                    disabled={isRunning}
                    className="w-full px-2 py-1.5 border rounded bg-background text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">并发数</label>
                  <select
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    disabled={isRunning}
                    className="w-full px-2 py-1.5 border rounded bg-background text-xs"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* 右侧：邮箱账号输入 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Mail className="w-4 h-4" />
                  邮箱账号
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <textarea
                  className="w-full h-20 p-2 border rounded bg-background resize-none font-mono text-xs"
                  placeholder="example@outlook.com"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  disabled={isRunning}
                />
                <div className="flex gap-1.5 flex-wrap">
                  <Button variant="outline" size="sm" onClick={handlePaste} disabled={isRunning} className="h-7 text-xs px-2">
                    <Clipboard className="w-3 h-3 mr-1" />
                    粘贴
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleImport} disabled={isRunning || !inputText} className="h-7 text-xs px-2">
                    <RefreshCw className="w-3 h-3 mr-1" />
                    解析
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleImportFile} disabled={isRunning} className="h-7 text-xs px-2">
                    <Upload className="w-3 h-3 mr-1" />
                    导入
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleClear} disabled={isRunning} className="h-7 text-xs px-2">
                    <Trash2 className="w-3 h-3 mr-1" />
                    清空
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 设备同步 */}
          <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-200">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Layers className="w-4 h-4" />
                  设备同步
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {deviceSyncConfig.enabled ? '已启用' : '已禁用'}
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deviceSyncConfig.enabled}
                      onChange={(e) => setDeviceSyncConfig({ enabled: e.target.checked })}
                      disabled={isRunning}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                  </label>
                </div>
              </div>
            </CardHeader>
            {deviceSyncConfig.enabled && (
              <CardContent className="space-y-2">
                <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
                  将本地账号同步到云端服务器，实现多设备数据共享
                </div>

                {/* 服务器地址 */}
                <div>
                  <label className="text-xs font-medium mb-1 block">服务器地址</label>
                  <input
                    type="text"
                    className="w-full px-2 py-1.5 border rounded bg-background text-xs font-mono"
                    placeholder="http://your-server:3002"
                    value={deviceSyncConfig.serverUrl}
                    onChange={(e) => setDeviceSyncConfig({ serverUrl: e.target.value })}
                    disabled={isRunning}
                  />
                </div>

                {/* 认证 Token */}
                <div>
                  <label className="text-xs font-medium mb-1 block">认证 Token</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={showToken ? "text" : "password"}
                        className="w-full px-2 py-1.5 pr-8 border rounded bg-background text-xs font-mono"
                        placeholder="your-jwt-token"
                        value={deviceSyncConfig.authToken}
                        onChange={(e) => setDeviceSyncConfig({ authToken: e.target.value })}
                        disabled={isRunning}
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showToken ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGetToken}
                      disabled={isGettingToken || !deviceSyncConfig.serverUrl || isRunning}
                      className="h-7 text-xs px-2"
                    >
                      {isGettingToken ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Key className="h-3 w-3 mr-1" />
                      )}
                      {isGettingToken ? '获取中...' : '自动获取'}
                    </Button>
                  </div>
                </div>

                {/* 设备信息 */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs font-medium mb-1 block">设备 ID</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1.5 border rounded bg-background text-xs font-mono"
                      placeholder="device-id"
                      value={deviceSyncConfig.deviceId}
                      onChange={(e) => setDeviceSyncConfig({ deviceId: e.target.value })}
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">设备名称</label>
                    <input
                      type="text"
                      className="w-full px-2 py-1.5 border rounded bg-background text-xs"
                      placeholder="My Device"
                      value={deviceSyncConfig.deviceName}
                      onChange={(e) => setDeviceSyncConfig({ deviceName: e.target.value })}
                      disabled={isRunning}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">设备类型</label>
                    <select
                      className="w-full px-2 py-1.5 border rounded bg-background text-xs"
                      value={deviceSyncConfig.deviceType}
                      onChange={(e) => setDeviceSyncConfig({ deviceType: e.target.value as 'desktop' | 'mobile' | 'tablet' })}
                      disabled={isRunning}
                    >
                      <option value="desktop">桌面</option>
                      <option value="mobile">移动</option>
                      <option value="tablet">平板</option>
                    </select>
                  </div>
                </div>

                {/* 同步状态 */}
                {deviceSyncConfig.lastSyncTime > 0 && (
                  <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
                    <p>上次同步: {new Date(deviceSyncConfig.lastSyncTime).toLocaleString()}</p>
                    <p>同步版本: {deviceSyncConfig.lastSyncVersion}</p>
                  </div>
                )}

                {/* 同步按钮 */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <div>
                    <p className="text-xs font-medium">同步到服务器</p>
                    <p className="text-xs text-muted-foreground">
                      将 {existingAccounts.size} 个账号同步到云端
                    </p>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSyncToServer}
                    disabled={isSyncing || !deviceSyncConfig.serverUrl || !deviceSyncConfig.authToken || !deviceSyncConfig.deviceId || existingAccounts.size === 0 || isRunning}
                    className="h-7 text-xs px-2"
                  >
                    {isSyncing ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3 mr-1" />
                    )}
                    {isSyncing ? '同步中...' : '同步'}
                  </Button>
                </div>

                {/* 同步结果 */}
                {syncResult && (
                  <div className={`text-xs p-2 rounded-lg ${syncResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {syncResult.success ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-3 w-3" />
                        <p>同步成功：已同步 {syncResult.synced} 个账号</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <XCircle className="h-3 w-3" />
                        <p>同步失败: {syncResult.error}</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
    </div>
  )}

  {/* 账号列表 Tab */}
  {activeTab === 'accounts' && accounts.length > 0 && (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Key className="w-4 h-4" />
          注册列表
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <div className="border rounded overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-1.5 text-left text-xs font-medium">序号</th>
                <th className="px-3 py-1.5 text-left text-xs font-medium">邮箱</th>
                <th className="px-3 py-1.5 text-left text-xs font-medium">姓名</th>
                <th className="px-3 py-1.5 text-left text-xs font-medium">状态</th>
                <th className="px-3 py-1.5 text-left text-xs font-medium">Token</th>
                <th className="px-3 py-1.5 text-left text-xs font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account, index) => (
                <tr key={account.id} className="border-t">
                  <td className="px-3 py-1.5 text-xs">{index + 1}</td>
                  <td className="px-3 py-1.5 text-xs font-mono">{account.email}</td>
                  <td className="px-3 py-1.5 text-xs">{account.awsName || '-'}</td>
                  <td className="px-3 py-1.5">{getStatusBadge(account.status)}</td>
                  <td className="px-3 py-1.5 text-xs font-mono">
                    {account.ssoToken ? account.ssoToken.substring(0, 20) + '...' : '-'}
                  </td>
                  <td className="px-3 py-1.5">
                    {account.ssoToken && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToken(account.ssoToken!)}
                        className="h-6 w-6 p-0"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )}

  {activeTab === 'accounts' && accounts.length === 0 && (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        暂无账号，请先在配置页面添加邮箱账号
      </CardContent>
    </Card>
  )}

  {/* 日志 Tab */}
  {activeTab === 'logs' && (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Terminal className="w-4 h-4" />
          运行日志
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={clearLogs} className="h-7 px-2">
          <Trash2 className="w-3 h-3" />
        </Button>
      </CardHeader>
      <CardContent className="p-3">
        <div className="h-[500px] overflow-auto bg-black/90 rounded p-3 font-mono text-xs leading-tight space-y-0.5">
          {logs.length === 0 ? (
            <div className="text-gray-500">暂无日志</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={
                log.includes('✓') ? 'text-green-400' :
                log.includes('✗') || log.includes('错误') || log.includes('失败') ? 'text-red-400' :
                log.includes('=====') ? 'text-yellow-400' :
                log.includes('[stderr]') ? 'text-orange-400' :
                'text-gray-300'
              }>
                {log}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </CardContent>
    </Card>
  )}

  {/* 统计 Tab */}
  {activeTab === 'stats' && (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-muted-foreground mt-1">总数</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-yellow-500">{stats.pending}</div>
            <div className="text-xs text-muted-foreground mt-1">等待中</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-blue-500">{stats.running}</div>
            <div className="text-xs text-muted-foreground mt-1">进行中</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-green-500">{stats.success}</div>
            <div className="text-xs text-muted-foreground mt-1">成功</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-red-500">{stats.failed}</div>
            <div className="text-xs text-muted-foreground mt-1">失败</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-2xl font-bold text-orange-500">{stats.exists}</div>
            <div className="text-xs text-muted-foreground mt-1">已存在</div>
          </CardContent>
        </Card>
      </div>

      {/* 成功率 */}
      {stats.total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">注册成功率</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span>成功率</span>
                <span className="font-bold">{((stats.success / stats.total) * 100).toFixed(1)}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div
                  className="bg-green-500 h-3 rounded-full transition-all"
                  style={{ width: `${(stats.success / stats.total) * 100}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">已完成: </span>
                <span className="font-bold">{stats.success + stats.failed + stats.exists}</span>
              </div>
              <div>
                <span className="text-muted-foreground">待处理: </span>
                <span className="font-bold">{stats.pending + stats.running}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )}

    </div>
  )
}
