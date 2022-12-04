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
    let connect = chrome.runtime.connect({name: "cross_request-bridge"});

    // 这里监听
    win.addEventListener('message', (e) => {
        if (!e || !e.data || (typeof e.data) === 'string' || e.data.source !== 'cross_request_page' || !e.data.nodeId || !e.data.req || e.data.nodeId !== randomId) {
            return;
        }
        // 由内容脚本调用 chrome API 完成和background的交互
        connect.postMessage(e.data);
    });

    connect.onMessage.addListener((msg) => {
        if (msg.type !== 'fetch_callback') {
            return;
        }
        msg['source'] = "cross_request_content";
        // 透传给页面Window
        win.postMessage(msg, location.origin)
    })


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