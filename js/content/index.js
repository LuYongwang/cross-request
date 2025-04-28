(function (win) {
    let elementById = document.getElementById('cross-request-sign');
    // 判断是否启用插件
    if (!elementById) {
        return;
    }

    // 为了防止打开多个YAPI 导致同时发起多个请求，这里给每个DOM分配一个ID。
    let randomId = Math.random().toString(36).slice(2);
    elementById.setAttribute("data-nodeId", randomId)

    // 通信通道
    let connect = null;
    let isConnecting = false;
    
    function setupConnection() {
        // 防止重复连接
        if (isConnecting) {
            return;
        }
        
        try {
            isConnecting = true;
            connect = chrome.runtime.connect({name: "cross_request-bridge"});
            
            connect.onDisconnect.addListener(() => {
                isConnecting = false;
                if (chrome.runtime.lastError) {
                    const error = chrome.runtime.lastError;
                    console.warn('Connection lost:', error.message);
                    
                    // 如果是扩展上下文失效，通知用户刷新页面
                    if (error.message.includes('Extension context invalidated')) {
                        console.warn('Extension has been reloaded or updated. Please refresh the page.');
                        // 可以在这里添加一个视觉提示
                        const notification = document.createElement('div');
                        notification.style.cssText = `
                            position: fixed;
                            top: 20px;
                            right: 20px;
                            background: #ff4444;
                            color: white;
                            padding: 10px 20px;
                            border-radius: 4px;
                            z-index: 999999;
                        `;
                        notification.textContent = '扩展已更新，请刷新页面';
                        document.body.appendChild(notification);
                        setTimeout(() => notification.remove(), 5000);
                        return;
                    }
                }
                // 只有在非扩展上下文失效的情况下才重连
                setTimeout(setupConnection, 1000);
            });
        } catch (error) {
            isConnecting = false;
            console.warn('Failed to setup connection:', error);
            if (error.message.includes('Extension context invalidated')) {
                console.warn('Extension has been reloaded or updated. Please refresh the page.');
                return;
            }
            // 其他错误则尝试重连
            setTimeout(setupConnection, 1000);
        }
    }
    
    setupConnection();

    // 这里监听
    win.addEventListener('message', (e) => {
        if (!e || !e.data || (typeof e.data) === 'string' || e.data.source !== 'cross_request_page' || !e.data.nodeId || !e.data.req || e.data.nodeId !== randomId) {
            return;
        }

        // 检查连接状态并尝试重新连接
        if (!connect) {
            setupConnection();
        }
        
        try {
            connect.postMessage(e.data);
        } catch (error) {
            console.warn('Failed to send message:', error);
            if (error.message.includes('Extension context invalidated')) {
                console.warn('Extension has been reloaded or updated. Please refresh the page.');
                return;
            }
            // 其他错误则尝试重新连接
            setupConnection();
        }
    });

    connect.onMessage.addListener((msg) => {
        if (msg.type !== 'fetch_callback') {
            return;
        }
        msg['source'] = "cross_request_content";
        // 透传给页面Window
        win.postMessage(msg, location.origin)
    });

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