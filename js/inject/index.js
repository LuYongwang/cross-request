(function (win) {
    // 判断是否启用插件
    let elementById = document.getElementById('cross-request-sign');
    if (!elementById) {
        return;
    }
    // 获取当前页面的ID
    let randomId = elementById.getAttribute("data-nodeId");

    // 生成随机ID
    let guid = function () {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // 请求配置验证
    function validateRequest(req) {
        if (!req) {
            throw new Error('Request configuration is required');
        }
        if (!req.url) {
            throw new Error('URL is required');
        }
        if (req.method && !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method.toUpperCase())) {
            throw new Error('Invalid HTTP method');
        }
        return true;
    }

    // 处理文件上传
    function handleFileUpload(files) {
        if (!files) return null;
        
        const formData = new FormData();
        for (const [key, fileId] of Object.entries(files)) {
            const fileInput = document.getElementById(fileId);
            if (!fileInput || !fileInput.files || !fileInput.files[0]) {
                throw new Error(`File input with id ${fileId} not found or empty`);
            }
            formData.append(key, fileInput.files[0]);
        }
        return formData;
    }

    // 请求拦截器
    const requestInterceptors = [];
    function addRequestInterceptor(interceptor) {
        if (typeof interceptor === 'function') {
            requestInterceptors.push(interceptor);
        }
    }

    // 响应拦截器
    const responseInterceptors = [];
    function addResponseInterceptor(interceptor) {
        if (typeof interceptor === 'function') {
            responseInterceptors.push(interceptor);
        }
    }

    win.crossRequest = function (req) {
        try {
            // 验证请求配置
            validateRequest(req);

            // 处理字符串形式的URL
            if (typeof req === 'string') {
                req = { url: req };
            }

            // 分配请求UUID
            let requestId = guid();

            // 处理文件上传
            if (req.files) {
                req.data = handleFileUpload(req.files);
                delete req.files;
            }

            // 应用请求拦截器
            for (const interceptor of requestInterceptors) {
                req = interceptor(req);
            }

            // 记录请求到全局
            win['cross_request_' + requestId] = {
                success: function (res, header, data) {
                    // 应用响应拦截器
                    for (const interceptor of responseInterceptors) {
                        res = interceptor(res);
                    }
                    if (typeof req.success === 'function') {
                        req.success(res, header, data);
                    }
                },
                error: function (error, header, data) {
                    if (typeof req.error === 'function') {
                        req.error(error, header, data);
                    }
                }
            };

            // 发送请求通知
            win.postMessage({
                "source": "cross_request_page",
                "nodeId": randomId,
                "type": "fetch",
                "req": {
                    "caseId": req.caseId,
                    "requestId": requestId,
                    "url": req.url,
                    "method": req.method || "GET",
                    "headers": req.headers || {},
                    "data": req.data || "",
                    "taskId": req.taskId || "",
                    "timeout": req.timeout || 30000,
                }
            }, location.origin);

            // 返回请求ID，可用于取消请求
            return requestId;
        } catch (error) {
            if (typeof req.error === 'function') {
                req.error(error);
            }
            throw error;
        }
    };

    // 添加拦截器方法
    win.crossRequest.addRequestInterceptor = addRequestInterceptor;
    win.crossRequest.addResponseInterceptor = addResponseInterceptor;

    // 取消请求方法
    win.crossRequest.cancel = function(requestId) {
        if (win['cross_request_' + requestId]) {
            delete win['cross_request_' + requestId];
            return true;
        }
        return false;
    };

    win.addEventListener('message', (e) => {
        if (!e || !e.data || (typeof e.data) === 'string' || 
            e.data.source !== 'cross_request_content' || 
            !e.data.nodeId || 
            e.data.nodeId !== randomId) {
            return;
        }

        if (e.data.type === "fetch_callback") {
            let requestId = e.data['requestId'];
            let reqFun = win['cross_request_' + requestId];
            
            if (!reqFun) {
                return; // 请求已被取消
            }

            if (e.data.success) {
                reqFun['success'](e.data.res, e.data.res.header, e.data || {});
            } else {
                reqFun['error'](e.data.res, e.data.res.header, e.data || {});
            }
            delete win['cross_request_' + requestId];
        }
    });
})(window);

