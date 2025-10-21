(function (globalThis) {
    // 请求配置
    const DEFAULT_CONFIG = {
        timeout: 5000,
        maxRetries: 3,
        retryDelay: 1000,
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        rateLimit: {
            windowMs: 60000,
            max: 100
        }
    };
    
    let CONFIG = { ...DEFAULT_CONFIG };

    // 加载配置
    async function loadConfig() {
        try {
            const result = await chrome.storage.sync.get('requestConfig');
            if (result.requestConfig) {
                CONFIG = {
                    ...DEFAULT_CONFIG,
                    ...result.requestConfig,
                    allowedMethods: DEFAULT_CONFIG.allowedMethods,
                    rateLimit: {
                        ...DEFAULT_CONFIG.rateLimit,
                        ...(result.requestConfig.rateLimit || {})
                    }
                };
            }
        } catch (error) {
            console.warn('Failed to load config:', error);
            CONFIG = { ...DEFAULT_CONFIG };
        }
    }

    // 保存配置
    async function saveConfig(newConfig) {
        try {
            // 验证新配置
            if (newConfig.timeout && (newConfig.timeout < 1000 || newConfig.timeout > 30000)) {
                throw new Error('超时时间必须在1000-30000毫秒之间');
            }
            if (newConfig.maxRetries && (newConfig.maxRetries < 0 || newConfig.maxRetries > 10)) {
                throw new Error('重试次数必须在0-10之间');
            }
            if (newConfig.retryDelay && (newConfig.retryDelay < 100 || newConfig.retryDelay > 5000)) {
                throw new Error('重试延迟必须在100-5000毫秒之间');
            }

            // 只保存允许修改的字段
            const configToSave = {
                timeout: newConfig.timeout,
                maxRetries: newConfig.maxRetries,
                retryDelay: newConfig.retryDelay
            };

            await chrome.storage.sync.set({ requestConfig: configToSave });
            CONFIG = { ...CONFIG, ...configToSave };
            return true;
        } catch (error) {
            console.warn('Failed to save config:', error);
            throw error;
        }
    }

    // 监听配置更新
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.requestConfig) {
            const newConfig = changes.requestConfig.newValue;
            CONFIG = {
                ...DEFAULT_CONFIG,
                ...newConfig,
                allowedMethods: DEFAULT_CONFIG.allowedMethods,
                rateLimit: {
                    ...DEFAULT_CONFIG.rateLimit,
                    ...(newConfig.rateLimit || {})
                }
            };
        }
    });

    // 初始化加载配置
    loadConfig();
    
    // 定期清理过期的CORS规则
    setInterval(() => {
        corsRuleManager.cleanup();
    }, 60000); // 每分钟清理一次

    // 请求计数器
    const requestCounters = new Map();

    // URL 验证
    function isValidUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
        } catch {
            return false;
        }
    }

    // 请求频率限制检查
    function checkRateLimit(origin) {
        const now = Date.now();
        const counter = requestCounters.get(origin) || { count: 0, timestamp: now };
        
        if (now - counter.timestamp > CONFIG.rateLimit.windowMs) {
            counter.count = 1;
            counter.timestamp = now;
        } else if (counter.count >= CONFIG.rateLimit.max) {
            return false;
        } else {
            counter.count++;
        }
        
        requestCounters.set(origin, counter);
        return true;
    }

    // CORS规则管理器
    const corsRuleManager = {
        rules: new Map(),
        nextRuleId: 1,
        
        generateRuleId() {
            // 确保返回一个唯一的正整数
            const id = this.nextRuleId++;
            // 双重确保返回整数类型
            return parseInt(id.toString(), 10);
        },
        
        async addRule(url) {
            try {
                const urlObj = new URL(url);
                const ruleId = this.generateRuleId();
                
                // 先清理可能存在的旧规则
                const existingRules = Array.from(this.rules.keys());
                if (existingRules.length > 0) {
                    try {
                        await chrome.declarativeNetRequest.updateDynamicRules({
                            removeRuleIds: existingRules
                        });
                        this.rules.clear();
                    } catch (cleanupError) {
                        console.warn('Failed to cleanup existing rules:', cleanupError);
                    }
                }
                
                const rule = {
                    id: ruleId,
                    priority: 1,
                    action: {
                        type: "modifyHeaders",
                        responseHeaders: [
                            { header: "Access-Control-Allow-Origin", operation: "set", value: "*" },
                            { header: "Access-Control-Allow-Methods", operation: "set", value: "GET, POST, PUT, DELETE, PATCH, OPTIONS" },
                            { header: "Access-Control-Allow-Headers", operation: "set", value: "*" },
                            { header: "Access-Control-Allow-Credentials", operation: "set", value: "true" }
                        ]
                    },
                    condition: {
                        urlFilter: urlObj.origin + "/*",
                        resourceTypes: ["xmlhttprequest"]
                    }
                };
                
                await chrome.declarativeNetRequest.updateDynamicRules({
                    addRules: [rule]
                });
                
                this.rules.set(ruleId, { url: urlObj.origin, timestamp: Date.now() });
                return ruleId;
            } catch (error) {
                console.warn('Failed to add CORS rule:', error);
                return null;
            }
        },
        
        async removeRule(ruleId) {
            if (!ruleId) return;
            
            try {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: [ruleId]
                });
                this.rules.delete(ruleId);
            } catch (error) {
                console.warn('Failed to remove CORS rule:', error);
            }
        },
        
        async cleanup() {
            const now = Date.now();
            const expiredRules = [];
            
            for (const [ruleId, rule] of this.rules.entries()) {
                if (now - rule.timestamp > 300000) { // 5分钟过期
                    expiredRules.push(ruleId);
                }
            }
            
            if (expiredRules.length > 0) {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: expiredRules
                });
                expiredRules.forEach(id => this.rules.delete(id));
            }
        }
    };

    // 重试机制
    async function fetchWithRetry(req, retryCount = 0) {
        let ruleId = null;
        let timeoutId = null;
        let controller = null;

        try {
            controller = new AbortController();
            timeoutId = setTimeout(() => {
                controller.abort();
                console.warn(`Request timeout after ${CONFIG.timeout}ms`);
            }, CONFIG.timeout);

            const method = (req.method || "GET").toUpperCase();
            const data = req.data || "";
            const headers = req.headers || {};
            
            // 添加CORS规则
            ruleId = await corsRuleManager.addRule(req.url);
            
            // 构建请求配置
            const reqConfig = {
                method: method,
                headers: { ...headers }, // 确保headers被正确复制
                mode: 'cors',
                credentials: 'include',
                signal: controller.signal
            };

            // 处理POST请求的body和Content-Type
            if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
                const contentType = headers['Content-Type'] || headers['content-type'] || "application/json";
                
                if (contentType.includes("json")) {
                    reqConfig.body = typeof data === 'string' ? data : JSON.stringify(data);
                } else if (contentType.includes("x-www-form-urlencoded")) {
                    reqConfig.body = new URLSearchParams(data);
                } else if (contentType.includes("multipart/form-data")) {
                    reqConfig.body = data; // FormData对象
                } else {
                    reqConfig.body = data;
                }
                
                // 确保Content-Type被正确设置
                if (!reqConfig.headers['Content-Type'] && !reqConfig.headers['content-type']) {
                    reqConfig.headers['Content-Type'] = contentType;
                }
            }

            // 记录请求日志
            console.log('🚀 [Cross-Request] 发起请求:', {
                url: req.url,
                method: method,
                headers: reqConfig.headers,
                body: reqConfig.body,
                timestamp: new Date().toISOString()
            });

            const response = await fetch(req.url, reqConfig);
            
            // 记录响应日志
            console.log('✅ [Cross-Request] 收到响应:', {
                url: req.url,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                timestamp: new Date().toISOString()
            });
            
            // 清理资源
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }

            if (ruleId) {
                await corsRuleManager.removeRule(ruleId);
                ruleId = null;
            }

            return response;
        } catch (error) {
            // 记录错误日志
            console.error('❌ [Cross-Request] 请求失败:', {
                url: req.url,
                method: req.method || 'GET',
                error: error.message,
                name: error.name,
                retryCount: retryCount,
                timestamp: new Date().toISOString()
            });
            
            // 清理资源
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }

            if (ruleId) {
                await corsRuleManager.removeRule(ruleId);
                ruleId = null;
            }

            // 处理超时错误
            if (error.name === 'AbortError') {
                error.message = `请求超时 (${CONFIG.timeout}ms)`;
            }

            // 重试逻辑
            if (retryCount < CONFIG.maxRetries && 
                (error.name === 'AbortError' || error.name === 'TypeError' || error.message.includes('network'))) {
                const delay = CONFIG.retryDelay * (retryCount + 1);
                console.warn(`🔄 [Cross-Request] 重试请求 (${retryCount + 1}/${CONFIG.maxRetries}) 延迟 ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchWithRetry(req, retryCount + 1);
            }

            throw error;
        }
    }

    // 响应处理
    async function handleResponse(res) {
        const resText = await res.text();
        let parsedBody;
        try {
            parsedBody = JSON.parse(resText);
        } catch (e) {
            parsedBody = resText;
        }

        const headers = {};
        for (const [key, value] of res.headers.entries()) {
            headers[key] = value;
        }

        return {
            header: headers,
            status: res.status,
            statusText: res.statusText,
            body: parsedBody
        };
    }

    // 错误处理
    function handleError(error) {
        const errorInfo = {
            error: true,
            message: error.message || '未知错误',
            name: error.name || 'Error',
            stack: error.stack
        };

        // 添加更多错误信息
        if (error.name === 'AbortError') {
            errorInfo.type = 'timeout';
            errorInfo.details = `请求超时 (${CONFIG.timeout}ms)`;
        } else if (error.name === 'TypeError' && error.message.includes('network')) {
            errorInfo.type = 'network';
            errorInfo.details = '网络错误';
        }

        return errorInfo;
    }

    let fetchData = async function (req) {
        // 验证请求
        if (!isValidUrl(req.url)) {
            throw new Error('无效的URL');
        }

        if (!CONFIG.allowedMethods.includes(req.method?.toUpperCase())) {
            throw new Error('不支持的请求方法');
        }

        const origin = new URL(req.url).origin;
        if (!checkRateLimit(origin)) {
            throw new Error('请求频率超限');
        }

        try {
            const response = await fetchWithRetry(req);
            return await handleResponse(response);
        } catch (error) {
            throw handleError(error);
        }
    };

    // 连接处理
    globalThis.chrome.runtime.onConnect.addListener((connect) => {
        if (connect.name !== 'cross_request-bridge') {
            return;
        }

        connect.onMessage.addListener(async (msg) => {
            try {
                console.log('📨 [Cross-Request] 收到请求消息:', {
                    nodeId: msg.nodeId,
                    requestId: msg.req.requestId,
                    url: msg.req.url,
                    method: msg.req.method,
                    timestamp: new Date().toISOString()
                });
                
                const resData = await fetchData(msg.req);
                
                console.log('📤 [Cross-Request] 发送成功响应:', {
                    nodeId: msg.nodeId,
                    requestId: msg.req.requestId,
                    status: resData.status,
                    timestamp: new Date().toISOString()
                });
                
                connect.postMessage({
                    type: "fetch_callback",
                    nodeId: msg.nodeId,
                    requestId: msg.req.requestId,
                    success: true,
                    res: resData
                });
            } catch (error) {
                console.log('📤 [Cross-Request] 发送错误响应:', {
                    nodeId: msg.nodeId,
                    requestId: msg.req.requestId,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
                
                connect.postMessage({
                    type: "fetch_callback",
                    nodeId: msg.nodeId,
                    requestId: msg.req.requestId,
                    success: false,
                    res: error
                });
            }
        });

        // 处理连接断开
        connect.onDisconnect.addListener(() => {
            if (chrome.runtime.lastError) {
                console.warn('Connection lost:', chrome.runtime.lastError.message);
            }
        });
    });

    // 配置更新处理
    globalThis.chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'getConfig') {
            sendResponse(CONFIG);
            return true;
        }
        if (message.type === 'updateConfig') {
            saveConfig(message.config)
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        }
    });

})(globalThis);