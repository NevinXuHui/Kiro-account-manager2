import { io, Socket } from 'socket.io-client'
import os from 'os'

class DeviceConnectionService {
  private socket: Socket | null = null
  private authToken: string = ''
  private deviceId: string = ''
  private deviceName: string = ''
  private accountType: string = 'supplier'
  private heartbeatInterval: NodeJS.Timeout | null = null

  connect(serverUrl: string, authToken: string, deviceId: string, deviceName: string, accountType: string = 'supplier') {
    // 如果已连接，先断开
    if (this.socket?.connected) {
      this.disconnect()
    }

    this.authToken = authToken
    this.deviceId = deviceId
    this.deviceName = deviceName
    this.accountType = accountType

    console.log(`[Device] Connecting to ${serverUrl}...`)

    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    })

    this.socket.on('connect', () => {
      console.log('[Device] Connected to server')
      this.register()
      this.startHeartbeat()
    })

    this.socket.on('disconnect', () => {
      console.log('[Device] Disconnected from server')
      this.stopHeartbeat()
    })

    this.socket.on('device:registered', (data: { success: boolean }) => {
      if (data.success) {
        console.log('[Device] Registration successful')
        // 注册成功后立即发送一次心跳
        this.sendHeartbeat()
      }
    })

    this.socket.on('device:error', (data: { message: string }) => {
      console.error('[Device] Error:', data.message)

      // 如果是认证失败，通知渲染进程重新获取 token
      if (data.message === 'Authentication failed') {
        console.log('[Device] Authentication failed, token may be invalid')
        // 断开连接，等待新 token
        this.disconnect()
      }
    })

    this.socket.on('connect_error', (error) => {
      console.error('[Device] Connection error:', error.message)
    })
  }

  private register() {
    if (!this.socket?.connected) return

    const deviceType = os.platform() === 'darwin' ? 'desktop' :
                      os.platform() === 'win32' ? 'desktop' : 'desktop'

    this.socket.emit('device:register', {
      token: this.authToken,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      deviceType,
      accountType: this.accountType
    })
  }

  private sendHeartbeat() {
    if (this.socket?.connected) {
      this.socket.emit('device:heartbeat', {
        deviceId: this.deviceId
      })
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat()

    // 立即发送一次心跳
    this.sendHeartbeat()

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, 15000) // 每15秒发送一次心跳
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  disconnect() {
    console.log('[Device] Disconnecting...')
    this.stopHeartbeat()

    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false
  }
}

export const deviceConnectionService = new DeviceConnectionService()
