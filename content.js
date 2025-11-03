// Content Script: 在 bilibili.com 页面上下文中执行
// 自动继承页面的所有 Cookie 和上下文

console.log('[Bilibili Helper] Content Script 已加载');

/**
 * 从页面 Cookie 中获取 CSRF Token
 */
function getCsrfTokenFromPage() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'bili_jct') {
            return value;
        }
    }
    return null;
}

/**
 * 在页面上下文中拉黑用户
 */
async function blockUserInPage(userId) {
    try {
        const csrf = getCsrfTokenFromPage();
        if (!csrf) {
            return {
                success: false,
                message: '未找到 CSRF Token,请先登录 Bilibili'
            };
        }

        console.log('[Content Script] 拉黑用户:', userId);

        const formData = new URLSearchParams({
            fid: userId,
            act: '5',  // 5=拉黑
            re_src: '11',
            gaia_source: 'web_main',
            spmid: '333.1387',
            extend_content: JSON.stringify({
                entity: 'user',
                entity_id: parseInt(userId)
            }),
            is_from_frontend_component: 'true',
            csrf: csrf
        });

        const response = await fetch(
            'https://api.bilibili.com/x/relation/modify?statistics=%7B%22appId%22:100,%22platform%22:5%7D',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData.toString(),
                credentials: 'include'
            }
        );

        const result = await response.json();
        console.log('[Content Script] 拉黑响应:', result);

        if (result.code === 0) {
            return { success: true, message: '拉黑成功', data: result };
        } else {
            return { success: false, message: result.message || '拉黑失败', data: result };
        }
    } catch (error) {
        console.error('[Content Script] 拉黑错误:', error);
        return { success: false, message: error.message };
    }
}

/**
 * 在页面上下文中取消拉黑用户
 */
async function unblockUserInPage(userId) {
    try {
        const csrf = getCsrfTokenFromPage();
        if (!csrf) {
            return {
                success: false,
                message: '未找到 CSRF Token,请先登录 Bilibili'
            };
        }

        console.log('[Content Script] 取消拉黑用户:', userId);

        const formData = new URLSearchParams({
            fid: userId,
            act: '6',  // 6=取消拉黑
            re_src: '11',
            gaia_source: 'web_main',
            spmid: '333.1387',
            extend_content: JSON.stringify({
                entity: 'user',
                entity_id: parseInt(userId)
            }),
            is_from_frontend_component: 'true',
            csrf: csrf
        });

        const response = await fetch(
            'https://api.bilibili.com/x/relation/modify?statistics=%7B%22appId%22:100,%22platform%22:5%7D',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData.toString(),
                credentials: 'include'
            }
        );

        const result = await response.json();
        console.log('[Content Script] 取消拉黑响应:', result);

        if (result.code === 0) {
            return { success: true, message: '取消拉黑成功', data: result };
        } else {
            return { success: false, message: result.message || '取消拉黑失败', data: result };
        }
    } catch (error) {
        console.error('[Content Script] 取消拉黑错误:', error);
        return { success: false, message: error.message };
    }
}

/**
 * 监听来自 Popup 的消息
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Content Script] 收到消息:', request);

    if (request.action === 'blockUser') {
        blockUserInPage(request.userId).then(sendResponse);
        return true; // 异步响应
    }

    if (request.action === 'unblockUser') {
        unblockUserInPage(request.userId).then(sendResponse);
        return true; // 异步响应
    }

    return false;
});
