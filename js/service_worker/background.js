(function (globalThis) {

    let fetchData = function (req) {

        let method = (req.method || "GET").toUpperCase();
        let data = req.data || ""
        let headers = req.headers || {}
        let reqConfig = {
            method: method, headers: headers, mode: 'no-cors'
        }
        if (method === 'POST') {
            let contentType = headers['Content-Type'] || headers['content-type'] || "application/json"
            if (contentType.includes("json")) {
                reqConfig['body'] = data
            } else if (contentType.includes("x-www-form-urlencoded")) {
                reqConfig['body'] = new URLSearchParams(data)
            }
        }
        return fetch(req['url'], reqConfig)
    }


    globalThis.chrome.runtime.onConnect.addListener((connect) => {
        if (connect.name !== 'cross_request-bridge') {
            return;
        }
        connect.onMessage.addListener((msg) => {
            console.log("ser", msg)
            fetchData(msg.req).then(async res => {
                let resText = await res.text();
                try {
                    resText = JSON.parse(resText)
                } catch (e) {

                }
                let headers = await res.headers.entries();
                let header = headers.next();
                let resHeader = {}
                while (!header.done) {
                    let key = header.value[0];
                    resHeader[key] = res.headers.get(key);
                    header = headers.next();
                }
                let resData = {
                    header: resHeader || {}, status: res.status, statusText: res.statusText, body: resText
                }
                connect.postMessage({
                    type: "fetch_callback",
                    nodeId: msg.nodeId,
                    requestId: msg.req.requestId,
                    success: true,
                    res: resData
                })
            }).catch(err => {
                connect.postMessage({
                    type: "fetch_callback", nodeId: msg.nodeId, requestId: msg.req.requestId, success: false, res: err
                })
            })
        })
    });


})(globalThis);