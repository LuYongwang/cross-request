document.addEventListener('DOMContentLoaded', async () => {
    // 获取DOM元素
    const timeoutInput = document.getElementById('timeout');
    const maxRetriesInput = document.getElementById('maxRetries');
    const retryDelayInput = document.getElementById('retryDelay');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    // 加载当前配置
    try {
        const config = await chrome.runtime.sendMessage({ type: 'getConfig' });
        timeoutInput.value = config.timeout;
        maxRetriesInput.value = config.maxRetries;
        retryDelayInput.value = config.retryDelay;
    } catch (error) {
        showStatus('加载配置失败: ' + error.message, false);
    }

    // 保存按钮点击事件
    saveButton.addEventListener('click', async () => {
        const newConfig = {
            timeout: parseInt(timeoutInput.value),
            maxRetries: parseInt(maxRetriesInput.value),
            retryDelay: parseInt(retryDelayInput.value)
        };

        // 验证输入
        if (isNaN(newConfig.timeout) || newConfig.timeout < 1000) {
            showStatus('超时时间必须大于等于1000毫秒', false);
            return;
        }
        if (isNaN(newConfig.maxRetries) || newConfig.maxRetries < 0 || newConfig.maxRetries > 10) {
            showStatus('重试次数必须在0-10之间', false);
            return;
        }
        if (isNaN(newConfig.retryDelay) || newConfig.retryDelay < 100) {
            showStatus('重试延迟时间必须大于等于100毫秒', false);
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'updateConfig',
                config: newConfig
            });
            
            if (response.success) {
                showStatus('配置已保存', true);
            } else {
                showStatus('保存失败: ' + (response.error || '未知错误'), false);
            }
        } catch (error) {
            showStatus('保存失败: ' + error.message, false);
        }
    });

    // 显示状态信息
    function showStatus(message, isSuccess) {
        statusDiv.textContent = message;
        statusDiv.className = 'status ' + (isSuccess ? 'success' : 'error');
        statusDiv.style.display = 'block';
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }
}); 