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


    win.crossRequest = function (req) {
        if (!req) return;
        if (typeof req === 'string') req = {url: req}
        // 分配请求UUID
        let requestId = guid();
        // 这里记录请求到全局
        win['cross_request_' + requestId] = {
            success: function (res, header, data) {
                if (typeof req.success === 'function') {
                    req.success(res, header, data);
                }
            }, error: function (error, header, data) {
                if (typeof req.error === 'function') {
                    req.error(error, header, data)
                }
            }
        }
        // 发送请求通知
        win.postMessage({
            "source": "cross_request_page", "nodeId": randomId, "type": "fetch", "req": {
                "caseId": req.caseId,
                "requestId": requestId,
                "url": req.url,
                "method": req.method || "GET",
                "headers": req.headers || {},
                "data": req.data || "",
                "taskId": req.taskId || "",
                "timeout": req.timeout || 30000,
            }
        }, location.origin)
    };

    win.addEventListener('message', (e) => {
        if (!e || !e.data || (typeof e.data) === 'string' || e.data.source !== 'cross_request_content' || !e.data.nodeId || e.data.nodeId !== randomId) {
            return;
        }
        if (e.data.type === "fetch_callback") {
            let requestId = e.data['requestId']
            let reqFun = win['cross_request_' + requestId]
            if (e.data.success) {
                reqFun['success'](e.data.res, e.data.res.header, e.data || {})
            } else {
                reqFun['error'](e.data.res, e.data.res.header, e.data || {})
            }
            delete win['cross_request_' + requestId];
        }
    });


})(window)

