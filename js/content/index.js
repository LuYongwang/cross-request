(function (win) {
    let elementById = document.getElementById('cross-request-sign');
    // 判断是否启用插件
    if (!elementById) {
        return;
    }

    // 为了防止打开多个YAPI 导致同时发起多个请求，这里给每个DOM分配一个ID。
    let randomId = Math.random().toString(36).slice(2);
    elementById.setAttribute("data-nodeId", randomId)

    // 通信通道管理器
    const connectionManager = {
        connect: null,
        isConnecting: false,
        reconnectAttempts: 0,
        maxReconnectAttempts: 5,
        reconnectDelay: 1000,
        
        setupConnection() {
            // 防止重复连接
            if (this.isConnecting) {
                return;
            }
            
            try {
                this.isConnecting = true;
                this.connect = chrome.runtime.connect({name: "cross_request-bridge"});
                
                this.connect.onDisconnect.addListener(() => {
                    this.isConnecting = false;
                    this.connect = null;
                    
                    if (chrome.runtime.lastError) {
                        const error = chrome.runtime.lastError;
                        console.warn('Connection lost:', error.message);
                        
                        // 如果是扩展上下文失效，通知用户刷新页面
                        if (error.message.includes('Extension context invalidated')) {
                            this.showNotification('扩展已更新，请刷新页面', 'error');
                            return;
                        }
                    }
                    
                    // 重连逻辑
                    this.handleReconnect();
                });
                
                // 重置重连计数
                this.reconnectAttempts = 0;
                
            } catch (error) {
                this.isConnecting = false;
                console.warn('Failed to setup connection:', error);
                
                if (error.message.includes('Extension context invalidated')) {
                    this.showNotification('扩展已更新，请刷新页面', 'error');
                    return;
                }
                
                this.handleReconnect();
            }
        },
        
        handleReconnect() {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                console.error('Max reconnection attempts reached');
                this.showNotification('连接失败，请检查扩展状态', 'error');
                return;
            }
            
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * this.reconnectAttempts;
            
            console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.setupConnection();
            }, delay);
        },
        
        showNotification(message, type = 'info') {
            const notification = document.createElement('div');
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: ${type === 'error' ? '#ff4444' : '#3498db'};
                color: white;
                padding: 10px 20px;
                border-radius: 4px;
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 14px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            `;
            notification.textContent = message;
            document.body.appendChild(notification);
            
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 5000);
        }
    };
    
    connectionManager.setupConnection();

    // 监听页面消息
    win.addEventListener('message', (e) => {
        if (!e || !e.data || (typeof e.data) === 'string' || e.data.source !== 'cross_request_page' || !e.data.nodeId || !e.data.req || e.data.nodeId !== randomId) {
            return;
        }

        // 检查连接状态并尝试重新连接
        if (!connectionManager.connect) {
            connectionManager.setupConnection();
            return;
        }
        
        try {
            connectionManager.connect.postMessage(e.data);
        } catch (error) {
            console.warn('Failed to send message:', error);
            if (error.message.includes('Extension context invalidated')) {
                connectionManager.showNotification('扩展已更新，请刷新页面', 'error');
                return;
            }
            // 其他错误则尝试重新连接
            connectionManager.setupConnection();
        }
    });

    // 监听来自扩展的消息
    if (connectionManager.connect) {
        connectionManager.connect.onMessage.addListener((msg) => {
            if (msg.type !== 'fetch_callback') {
                return;
            }
            msg['source'] = "cross_request_content";
            // 透传给页面Window
            win.postMessage(msg, location.origin);
        });
    }

    // 给Window注入JS
    function injectJs(path, callback) {
        let s = document.createElement('script');
        // 获取Chrome路径
        s.src = chrome.runtime.getURL(path);
        s.onload = function () {
            this.remove();
            callback && callback();
        };
        (document.head || document.documentElement).appendChild(s);
    }

    // 注入
    injectJs('/js/inject/index.js', function () {
        try {
            if (elementById) {
                elementById.setAttribute('key', 'yapi');
            }
        } catch (e) {
            console.error(e)
        }
    });
})(window)