(function (globalThis) {
    // 请求配置
    let CONFIG = {
        timeout: 5000,
        maxRetries: 3,
        retryDelay: 1000,
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
        rateLimit: {
            windowMs: 60000,
            max: 100
        }
    };

    // 加载配置
    async function loadConfig() {
        try {
            const result = await chrome.storage.sync.get('requestConfig');
            if (result.requestConfig) {
                // 确保所有必要的字段都存在
                CONFIG = {
                    ...CONFIG,
                    ...result.requestConfig,
                    // 确保这些字段不会被覆盖
                    allowedMethods: CONFIG.allowedMethods,
                    rateLimit: {
                        ...CONFIG.rateLimit,
                        ...(result.requestConfig.rateLimit || {})
                    }
                };
            }
        } catch (error) {
            console.warn('Failed to load config:', error);
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
            // 确保配置更新不会破坏核心功能
            CONFIG = {
                ...CONFIG,
                ...newConfig,
                allowedMethods: CONFIG.allowedMethods,
                rateLimit: {
                    ...CONFIG.rateLimit,
                    ...(newConfig.rateLimit || {})
                }
            };
        }
    });

    // 初始化加载配置
    loadConfig();

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

    // 添加CORS规则
    async function addCorsRule(url) {
        try {
            const urlObj = new URL(url);
            const ruleId = Math.floor(Math.random() * 1000000);
            
            // 先移除可能存在的相同规则
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: [ruleId]
            });

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

            return ruleId;
        } catch (error) {
            console.warn('Failed to add CORS rule:', error);
            return null;
        }
    }

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
            ruleId = await addCorsRule(req.url);
            
            const reqConfig = {
                method: method,
                headers: headers,
                mode: 'cors',
                credentials: 'include',
                signal: controller.signal
            };

            if (method === 'POST') {
                const contentType = headers['Content-Type'] || headers['content-type'] || "application/json";
                if (contentType.includes("json")) {
                    reqConfig.body = typeof data === 'string' ? data : JSON.stringify(data);
                } else if (contentType.includes("x-www-form-urlencoded")) {
                    reqConfig.body = new URLSearchParams(data);
                } else {
                    reqConfig.body = data;
                }
            }

            const response = await fetch(req.url, reqConfig);
            
            // 清理超时控制器
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }

            // 清理CORS规则
            if (ruleId) {
                await chrome.declarativeNetRequest.updateDynamicRules({
                    removeRuleIds: [ruleId]
                });
                ruleId = null;
            }

            return response;
        } catch (error) {
            // 清理超时控制器
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }

            // 清理CORS规则
            if (ruleId) {
                try {
                    await chrome.declarativeNetRequest.updateDynamicRules({
                        removeRuleIds: [ruleId]
                    });
                } catch (e) {
                    console.warn('Failed to remove CORS rule:', e);
                }
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
                console.warn(`Retrying request (${retryCount + 1}/${CONFIG.maxRetries}) after ${delay}ms`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return fetchWithRetry(req, retryCount + 1);
            }

            throw error;
        } finally {
            // 确保清理所有资源
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            if (ruleId) {
                try {
                    await chrome.declarativeNetRequest.updateDynamicRules({
                        removeRuleIds: [ruleId]
                    });
                } catch (e) {
                    console.warn('Failed to remove CORS rule in finally block:', e);
                }
            }
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
                const resData = await fetchData(msg.req);
                connect.postMessage({
                    type: "fetch_callback",
                    nodeId: msg.nodeId,
                    requestId: msg.req.requestId,
                    success: true,
                    res: resData
                });
            } catch (error) {
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