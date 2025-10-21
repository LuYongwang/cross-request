# Cross-Request Chrome Extension

一个赋予HTML页面跨域请求能力的Chrome扩展，支持YApi等API测试工具。

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-v3.1.2-blue.svg)](https://chrome.google.com/webstore/detail/cross-request/cmnlfmgbjmaciiopcgodlhpiklaghbok?hl=en-US)

## 功能特性

- ✅ **跨域请求支持**: 通过动态CORS规则绕过浏览器同源策略限制
- ✅ **多种HTTP方法**: 支持GET、POST、PUT、DELETE、PATCH等请求方法
- ✅ **智能重试机制**: 自动重试失败的请求，支持指数退避策略
- ✅ **请求配置管理**: 可配置超时时间、重试次数、重试延迟等参数
- ✅ **请求拦截器**: 支持请求和响应拦截器，便于调试和数据处理
- ✅ **频率限制保护**: 防止请求过于频繁，保护目标服务器
- ✅ **完善的错误处理**: 详细的错误信息和日志记录
- ✅ **Chrome Manifest V3**: 完全兼容最新的Chrome扩展标准

## 安装方式

### 方式一：Chrome Web Store（推荐）
1. 访问 [Chrome Web Store](https://chrome.google.com/webstore/detail/cross-request/cmnlfmgbjmaciiopcgodlhpiklaghbok?hl=en-US)
2. 点击"添加至Chrome"按钮
3. 确认安装

### 方式二：开发者模式安装
1. 下载或克隆本项目
2. 打开Chrome浏览器，进入 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目根目录

## 使用方法

### 基本用法

在需要跨域请求的页面中，确保页面包含以下标识元素：
```html
<div id="cross-request-sign"></div>
```

然后就可以使用 `crossRequest` 函数进行跨域请求。

### API 接口

```javascript
crossRequest(options)
```

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | String | 是 | 请求的URL地址 |
| method | String | 否 | HTTP方法，默认为GET |
| headers | Object | 否 | 请求头对象 |
| data | Object/String | 否 | 请求数据 |
| success | Function | 否 | 成功回调函数 |
| error | Function | 否 | 错误回调函数 |
| timeout | Number | 否 | 请求超时时间（毫秒） |

### 使用示例

#### 1. GET 请求
```javascript
crossRequest({
    url: 'http://caibaojian.com/ajax-jsonp.html',
    method: 'GET',
    success: function(res, header) {
        console.log('请求成功:', res);
        console.log('响应头:', header);
    },
    error: function(error) {
        console.error('请求失败:', error);
    }
})
```

#### 2. POST 请求
```javascript
crossRequest({
    url: 'http://127.0.0.1:3000/api',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    data: {
        a: 1,
        b: 2,
        c: {
            t: 1
        }
    },
    success: function(res, header) {
        console.log('请求成功:', res);
    },
    error: function(error) {
        console.error('请求失败:', error);
    }
})
```

#### 3. 文件上传（暂时禁用）
```javascript
crossRequest({
    url: 'http://127.0.0.1:8081/upload',
    method: 'POST',
    data: {
        name: 'hello',
        id: '19'
    },
    files: {
        file: 'fileId' // File Upload-Input dom id
    },
    success: function(res) {
        alert(res)
    }
})
```

### 高级功能

#### 请求拦截器
```javascript
// 添加请求拦截器
crossRequest.addRequestInterceptor(function(req) {
    console.log('请求拦截:', req);
    // 可以修改请求参数
    req.headers['Authorization'] = 'Bearer token';
    return req;
});

// 添加响应拦截器
crossRequest.addResponseInterceptor(function(res) {
    console.log('响应拦截:', res);
    // 可以修改响应数据
    return res;
});
```

#### 取消请求
```javascript
const requestId = crossRequest({
    url: 'http://example.com/api',
    success: function(res) {
        console.log(res);
    }
});

// 取消请求
crossRequest.cancel(requestId);
```

## 配置选项

点击扩展图标可以打开配置面板，设置以下参数：

- **请求超时时间**: 设置请求超时的时间限制（1000-30000毫秒）
- **最大重试次数**: 请求失败时的最大重试次数（0-10次）
- **重试延迟时间**: 两次重试之间的等待时间（100-5000毫秒）

## 技术架构

### 项目结构
```
cross-request/
├── manifest.json              # 扩展配置文件
├── popup.html                 # 扩展弹窗界面
├── js/
│   ├── popup.js              # 弹窗逻辑
│   ├── service_worker/
│   │   └── background.js     # Service Worker，处理跨域请求
│   ├── content/
│   │   └── index.js          # Content Script，页面通信
│   └── inject/
│       └── index.js          # 注入脚本，提供API
└── img/
    └── icon.png              # 扩展图标
```

### 工作原理

1. **Content Script** 检测页面中的 `cross-request-sign` 标识
2. **注入脚本** 向页面注入 `crossRequest` 函数
3. **Service Worker** 通过 `declarativeNetRequest` API 动态添加CORS规则
4. **请求处理** 使用 `fetch` API 发起跨域请求
5. **响应处理** 将结果通过消息传递返回给页面

## 开发说明

### 本地开发
1. 克隆项目：`git clone https://github.com/LuYongwang/cross-request.git`
2. 进入目录：`cd cross-request`
3. 在Chrome中加载扩展进行测试

### 构建发布
1. 确保代码无错误
2. 更新 `manifest.json` 中的版本号
3. 打包扩展文件
4. 提交到Chrome Web Store

## 常见问题

### Q: 为什么请求还是被CORS阻止？
A: 确保页面包含 `<div id="cross-request-sign"></div>` 标识元素。

### Q: 扩展无法正常工作？
A: 检查扩展是否已启用，并刷新页面重新加载。

### Q: 如何调试请求问题？
A: 打开浏览器开发者工具，查看Console中的详细日志信息。

## 更新日志

### v3.1.3
- 修复CORS规则添加错误
- 改进ID生成机制
- 增强错误处理
- 优化重试逻辑

### v3.1.0
- 升级到Chrome Manifest V3
- 重构Service Worker架构
- 添加配置管理功能
- 支持请求拦截器

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request来帮助改进这个项目。

## 相关链接

- [Chrome Web Store](https://chrome.google.com/webstore/detail/cross-request/cmnlfmgbjmaciiopcgodlhpiklaghbok?hl=en-US)
- [GitHub Repository](https://github.com/LuYongwang/cross-request)
- [DevTools Platform](https://devtools.yongwang.lu/)
