document.addEventListener('DOMContentLoaded', async () => {
    // 获取DOM元素
    const timeoutInput = document.getElementById('timeout');
    const maxRetriesInput = document.getElementById('maxRetries');
    const retryDelayInput = document.getElementById('retryDelay');
    const saveButton = document.getElementById('save');
    const statusDiv = document.getElementById('status');

    // 配置验证器
    const configValidator = {
        timeout: (value) => {
            const num = parseInt(value);
            return !isNaN(num) && num >= 1000 && num <= 30000;
        },
        maxRetries: (value) => {
            const num = parseInt(value);
            return !isNaN(num) && num >= 0 && num <= 10;
        },
        retryDelay: (value) => {
            const num = parseInt(value);
            return !isNaN(num) && num >= 100 && num <= 5000;
        }
    };

    // 加载当前配置
    try {
        const config = await chrome.runtime.sendMessage({ type: 'getConfig' });
        if (config) {
            timeoutInput.value = config.timeout || 5000;
            maxRetriesInput.value = config.maxRetries || 3;
            retryDelayInput.value = config.retryDelay || 1000;
        }
    } catch (error) {
        console.error('Failed to load config:', error);
        showStatus('加载配置失败: ' + error.message, false);
    }

    // 保存按钮点击事件
    saveButton.addEventListener('click', async () => {
        // 禁用按钮防止重复提交
        saveButton.disabled = true;
        saveButton.textContent = '保存中...';
        
        try {
            const newConfig = {
                timeout: parseInt(timeoutInput.value),
                maxRetries: parseInt(maxRetriesInput.value),
                retryDelay: parseInt(retryDelayInput.value)
            };

            // 验证输入
            const errors = [];
            if (!configValidator.timeout(timeoutInput.value)) {
                errors.push('超时时间必须在1000-30000毫秒之间');
            }
            if (!configValidator.maxRetries(maxRetriesInput.value)) {
                errors.push('重试次数必须在0-10之间');
            }
            if (!configValidator.retryDelay(retryDelayInput.value)) {
                errors.push('重试延迟时间必须在100-5000毫秒之间');
            }

            if (errors.length > 0) {
                showStatus(errors.join('; '), false);
                return;
            }

            const response = await chrome.runtime.sendMessage({
                type: 'updateConfig',
                config: newConfig
            });
            
            if (response && response.success) {
                showStatus('配置已保存', true);
            } else {
                showStatus('保存失败: ' + (response?.error || '未知错误'), false);
            }
        } catch (error) {
            console.error('Save config error:', error);
            showStatus('保存失败: ' + error.message, false);
        } finally {
            // 恢复按钮状态
            saveButton.disabled = false;
            saveButton.textContent = '保存配置';
        }
    });

    // 显示状态信息
    function showStatus(message, isSuccess) {
        statusDiv.textContent = message;
        statusDiv.className = 'status ' + (isSuccess ? 'success' : 'error');
        statusDiv.style.display = 'block';
        
        // 自动隐藏
        const hideTimeout = setTimeout(() => {
            statusDiv.style.display = 'none';
        }, isSuccess ? 2000 : 5000); // 成功消息显示2秒，错误消息显示5秒
        
        // 点击隐藏
        statusDiv.onclick = () => {
            clearTimeout(hideTimeout);
            statusDiv.style.display = 'none';
        };
    }
}); 