// 全局变量存储 Cookie 数据
let allCookies = [];
let filteredCount = 0; // 被过滤的 Cookie 数量

// Cookie 过滤黑名单配置
const COOKIE_BLACKLIST = {
    // 正则模式匹配(用于前缀/后缀匹配)
    patterns: [
        /^Hm_lvt_/,  // 百度统计访问记录
    ],
    // 精确匹配的 Cookie 名称
    exactNames: [
        'GIFT_BLOCK_COOKIE',
        'bmg_af_switch',
        'bmg_src_def_domain'
    ]
};

// ========== Bilibili API 相关函数 (通过 Content Script 执行) ==========

/**
 * 获取当前活动的 Bilibili 标签页
 */
async function getBilibiliTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];

    if (currentTab && currentTab.url && currentTab.url.includes('bilibili.com')) {
        return currentTab;
    }

    // 如果当前标签页不是 Bilibili,尝试查找已打开的 Bilibili 标签页
    const bilibiliTabs = await chrome.tabs.query({ url: '*://*.bilibili.com/*' });
    if (bilibiliTabs.length > 0) {
        return bilibiliTabs[0];
    }

    // 没有 Bilibili 标签页,打开一个新的
    const newTab = await chrome.tabs.create({ url: 'https://www.bilibili.com/', active: false });

    // 等待页面加载完成
    return new Promise((resolve) => {
        const listener = (tabId, changeInfo) => {
            if (tabId === newTab.id && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(newTab);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // 添加超时保护,避免无限等待
        setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(newTab);
        }, 10000); // 10秒超时
    });
}

/**
 * 从页面 Cookie 中获取 CSRF Token (保留用于显示)
 */
async function getCsrfToken() {
    return new Promise((resolve, reject) => {
        chrome.cookies.get({
            url: 'https://www.bilibili.com',
            name: 'bili_jct'
        }, (cookie) => {
            if (cookie && cookie.value) {
                resolve(cookie.value);
            } else {
                reject(new Error('未找到 CSRF Token,请先登录 Bilibili'));
            }
        });
    });
}

/**
 * 拉黑用户 (通过 Content Script 执行)
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<Object>} API 响应结果
 */
async function blockUser(userId) {
    try {
        console.log('[Popup] 开始拉黑用户:', userId);

        // 获取 Bilibili 标签页
        const tab = await getBilibiliTab();
        console.log('[Popup] 使用标签页:', tab.id, tab.url);

        // 验证是否为 Bilibili 页面
        if (!tab.url || !tab.url.includes('bilibili.com')) {
            return {
                success: false,
                message: '当前页面不是 Bilibili 网站'
            };
        }

        // 发送消息给 Content Script
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'blockUser',
            userId: userId
        });

        console.log('[Popup] 收到响应:', response);
        return response;
    } catch (error) {
        console.error('[Popup] 拉黑失败:', error);

        // 更详细的错误信息
        if (error.message && error.message.includes('Could not establish connection')) {
            return {
                success: false,
                message: '无法连接到页面,请刷新 Bilibili 页面后重试'
            };
        }

        return {
            success: false,
            message: error.message || '拉黑失败,请确保已打开 Bilibili 页面并登录'
        };
    }
}

/**
 * 取消拉黑用户 (通过 Content Script 执行)
 * @param {number|string} userId - 用户 ID
 * @returns {Promise<Object>} API 响应结果
 */
async function unblockUser(userId) {
    try {
        console.log('[Popup] 开始取消拉黑用户:', userId);

        // 获取 Bilibili 标签页
        const tab = await getBilibiliTab();
        console.log('[Popup] 使用标签页:', tab.id, tab.url);

        // 验证是否为 Bilibili 页面
        if (!tab.url || !tab.url.includes('bilibili.com')) {
            return {
                success: false,
                message: '当前页面不是 Bilibili 网站'
            };
        }

        // 发送消息给 Content Script
        const response = await chrome.tabs.sendMessage(tab.id, {
            action: 'unblockUser',
            userId: userId
        });

        console.log('[Popup] 收到响应:', response);
        return response;
    } catch (error) {
        console.error('[Popup] 取消拉黑失败:', error);

        // 更详细的错误信息
        if (error.message && error.message.includes('Could not establish connection')) {
            return {
                success: false,
                message: '无法连接到页面,请刷新 Bilibili 页面后重试'
            };
        }

        return {
            success: false,
            message: error.message || '取消拉黑失败,请确保已打开 Bilibili 页面并登录'
        };
    }
}

// ========== Cookie 管理函数 ==========

/**
 * 过滤不需要的 Cookie
 * @param {Array} cookies - 原始 Cookie 数组
 * @returns {Array} 过滤后的 Cookie 数组
 */
function filterCookies(cookies) {
    const originalCount = cookies.length;

    const filtered = cookies.filter(cookie => {
        // 检查精确匹配黑名单
        if (COOKIE_BLACKLIST.exactNames.includes(cookie.name)) {
            return false;
        }

        // 检查正则模式匹配
        if (COOKIE_BLACKLIST.patterns.some(pattern => pattern.test(cookie.name))) {
            return false;
        }

        return true;
    });

    filteredCount = originalCount - filtered.length;
    return filtered;
}

/**
 * 获取所有 Bilibili Cookie(包括 HttpOnly)
 */
async function getAllBilibiliCookies() {
    return new Promise((resolve) => {
        chrome.cookies.getAll({ domain: '.bilibili.com' }, (cookies) => {
            // 同时获取不带点的域名
            chrome.cookies.getAll({ domain: 'bilibili.com' }, (cookies2) => {
                // 合并并去重
                const allCookies = [...cookies, ...cookies2];
                const uniqueCookies = Array.from(
                    new Map(allCookies.map(c => [c.name, c])).values()
                );

                // 应用过滤规则
                const filteredCookies = filterCookies(uniqueCookies);

                resolve(filteredCookies);
            });
        });
    });
}

/**
 * 渲染 Cookie 表格
 */
function renderCookieTable(cookies) {
    const tbody = document.getElementById('cookieTableBody');
    tbody.innerHTML = '';

    if (cookies.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-message">未找到任何 Cookie,请先访问 Bilibili 网站</td></tr>';
        return;
    }

    cookies.forEach(cookie => {
        const row = document.createElement('tr');

        // 截断过长的值
        const truncatedValue = cookie.value.length > 30
            ? cookie.value.substring(0, 30) + '...'
            : cookie.value;

        row.innerHTML = `
            <td class="cookie-name" title="${escapeHtml(cookie.name)}">${escapeHtml(cookie.name)}</td>
            <td class="cookie-value" title="${escapeHtml(cookie.value)}">${escapeHtml(truncatedValue)}</td>
            <td>${escapeHtml(cookie.domain)}</td>
            <td>${escapeHtml(cookie.path)}</td>
            <td class="badge ${cookie.httpOnly ? 'badge-danger' : 'badge-success'}">
                ${cookie.httpOnly ? '✓' : '✗'}
            </td>
            <td class="badge ${cookie.secure ? 'badge-success' : 'badge-warning'}">
                ${cookie.secure ? '✓' : '✗'}
            </td>
            <td class="badge badge-info">${cookie.sameSite || 'no_restriction'}</td>
        `;

        tbody.appendChild(row);
    });

    // 更新统计信息
    updateStats(cookies);
}

/**
 * 更新统计信息
 */
function updateStats(cookies) {
    document.getElementById('totalCount').textContent = cookies.length;
    document.getElementById('httpOnlyCount').textContent =
        cookies.filter(c => c.httpOnly).length;
    document.getElementById('secureCount').textContent =
        cookies.filter(c => c.secure).length;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 显示状态消息
 */
function showStatus(message, type = 'info', duration = 5000) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status status-${type}`;
    statusEl.style.display = 'block';

    setTimeout(() => {
        statusEl.style.display = 'none';
    }, duration);
}

/**
 * 复制所有 Cookie 到剪贴板
 */
async function copyAllCookies() {
    if (allCookies.length === 0) {
        showStatus('没有可复制的 Cookie', 'error');
        return;
    }

    const cookieString = allCookies
        .map(c => `${c.name}=${c.value}`)
        .join('; ');

    try {
        await navigator.clipboard.writeText(cookieString);
        showStatus(`✓ 已复制 ${allCookies.length} 个 Cookie`, 'success');
    } catch (error) {
        showStatus('复制失败: ' + error.message, 'error');
    }
}

/**
 * 导出 JSON
 */
function exportJSON() {
    if (allCookies.length === 0) {
        showStatus('没有可导出的 Cookie', 'error');
        return;
    }

    const dataStr = JSON.stringify(allCookies, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `bilibili-cookies-${new Date().getTime()}.json`;
    link.click();

    URL.revokeObjectURL(url);
    showStatus('✓ JSON 文件已下载', 'success');
}

/**
 * 刷新 Cookie 列表
 */
async function refreshCookies() {
    showStatus('正在读取 Cookie...', 'info');

    try {
        allCookies = await getAllBilibiliCookies();
        renderCookieTable(allCookies);

        if (allCookies.length > 0) {
            const httpOnlyCount = allCookies.filter(c => c.httpOnly).length;
            let message = `✓ 成功读取 ${allCookies.length} 个 Cookie (含 ${httpOnlyCount} 个 HttpOnly)`;

            // 如果有过滤的 Cookie,追加提示
            if (filteredCount > 0) {
                message += ` | 已过滤 ${filteredCount} 个无关 Cookie`;
            }

            showStatus(message, 'success');
        } else {
            showStatus('未找到 Cookie,请先访问 Bilibili', 'warning');
        }
    } catch (error) {
        showStatus('读取失败: ' + error.message, 'error');
    }
}

// ========== Tab 切换功能 ==========

/**
 * 切换 Tab
 */
function switchTab(tabName) {
    // 移除所有 active 类
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

    // 添加 active 类到目标元素
    document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

// ========== 初始化 ==========

/**
 * 初始化
 */
document.addEventListener('DOMContentLoaded', () => {
    // 绑定 Tab 切换事件
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });

    // 绑定 Cookie 管理事件
    document.getElementById('refreshBtn').addEventListener('click', refreshCookies);
    document.getElementById('copyBtn').addEventListener('click', copyAllCookies);
    document.getElementById('exportBtn').addEventListener('click', exportJSON);

    // 绑定单个拉黑测试事件
    document.getElementById('blockBtn').addEventListener('click', handleBlockTest);
    document.getElementById('unblockBtn').addEventListener('click', handleUnblockTest);

    // 绑定批量操作事件
    document.getElementById('parseBtn').addEventListener('click', handleParseUrls);
    document.getElementById('batchBlockBtn').addEventListener('click', handleBatchBlock);
    document.getElementById('batchUnblockBtn').addEventListener('click', handleBatchUnblock);

    // 自动加载 Cookie
    refreshCookies();
});

// ========== 拉黑测试事件处理 ==========

/**
 * 拉黑测试按钮处理
 */
async function handleBlockTest() {
    const userId = document.getElementById('testUserId').value.trim();

    if (!userId) {
        showStatus('⚠️ 请输入用户 ID', 'warning');
        return;
    }

    // 隐藏之前的验证按钮
    document.getElementById('testResult').style.display = 'none';

    showStatus(`正在拉黑用户 ${userId}...`, 'info');

    try {
        const result = await blockUser(userId);
        console.log('拉黑结果:', result);

        if (result.success) {
            showStatus(`✓ ${result.message} (用户ID: ${userId})`, 'success');
            // 显示验证按钮
            showCheckUserButton(userId);
        } else {
            showStatus(`✗ ${result.message}`, 'error');
        }
    } catch (error) {
        showStatus(`✗ 拉黑失败: ${error.message}`, 'error');
        console.error('拉黑错误:', error);
    }
}

/**
 * 取消拉黑测试按钮处理
 */
async function handleUnblockTest() {
    const userId = document.getElementById('testUserId').value.trim();

    if (!userId) {
        showStatus('⚠️ 请输入用户 ID', 'warning');
        return;
    }

    // 隐藏之前的验证按钮
    document.getElementById('testResult').style.display = 'none';

    showStatus(`正在取消拉黑用户 ${userId}...`, 'info');

    try {
        const result = await unblockUser(userId);
        console.log('取消拉黑结果:', result);

        if (result.success) {
            showStatus(`✓ ${result.message} (用户ID: ${userId})`, 'success');
            // 显示验证按钮
            showCheckUserButton(userId);
        } else {
            showStatus(`✗ ${result.message}`, 'error');
        }
    } catch (error) {
        showStatus(`✗ 取消拉黑失败: ${error.message}`, 'error');
        console.error('取消拉黑错误:', error);
    }
}

/**
 * 显示查看用户空间按钮
 */
function showCheckUserButton(userId) {
    const testResult = document.getElementById('testResult');
    const checkUserBtn = document.getElementById('checkUserBtn');

    testResult.style.display = 'block';

    // 移除旧的事件监听器,添加新的
    const newBtn = checkUserBtn.cloneNode(true);
    checkUserBtn.parentNode.replaceChild(newBtn, checkUserBtn);

    newBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: `https://space.bilibili.com/${userId}` });
    });
}

// ========== 批量操作功能 ==========

let parsedUids = []; // 存储解析出的 UID 列表

/**
 * 从文本中提取所有 Bilibili 用户 UID
 */
function extractUids(text) {
    const uids = [];
    const regex = /space\.bilibili\.com\/(\d+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        const uid = match[1];
        if (!uids.includes(uid)) {
            uids.push(uid);
        }
    }

    return uids;
}

/**
 * 渲染 UID 列表
 */
function renderUidList(uids) {
    const listEl = document.getElementById('uidList');

    if (uids.length === 0) {
        listEl.innerHTML = '<div class="empty-message">未找到有效的 UID</div>';
        return;
    }

    listEl.innerHTML = `
        <div class="uid-count">解析到 <strong>${uids.length}</strong> 个用户 UID:</div>
        <div class="uid-items">
            ${uids.map((uid, index) => `
                <div class="uid-item" data-uid="${uid}">
                    <span class="uid-number">${index + 1}.</span>
                    <span class="uid-value">${uid}</span>
                    <span class="uid-status"></span>
                </div>
            `).join('')}
        </div>
    `;

    // 启用批量操作按钮
    document.getElementById('batchBlockBtn').disabled = false;
    document.getElementById('batchUnblockBtn').disabled = false;
}

/**
 * 解析 URL 列表按钮处理
 */
function handleParseUrls() {
    const urlInput = document.getElementById('urlInput').value.trim();

    if (!urlInput) {
        showStatus('⚠️ 请输入 URL 列表', 'warning');
        return;
    }

    parsedUids = extractUids(urlInput);
    console.log('[批量操作] 解析出的 UID:', parsedUids);

    renderUidList(parsedUids);

    if (parsedUids.length > 0) {
        showStatus(`✓ 成功解析 ${parsedUids.length} 个 UID`, 'success');
    } else {
        showStatus('⚠️ 未找到有效的 UID,请检查输入格式', 'warning');
    }
}

/**
 * 批量拉黑用户
 */
async function handleBatchBlock() {
    if (parsedUids.length === 0) {
        showStatus('⚠️ 请先解析 UID 列表', 'warning');
        return;
    }

    const progressEl = document.getElementById('batchProgress');
    const batchBlockBtn = document.getElementById('batchBlockBtn');
    const batchUnblockBtn = document.getElementById('batchUnblockBtn');

    // 禁用按钮
    batchBlockBtn.disabled = true;
    batchUnblockBtn.disabled = true;

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < parsedUids.length; i++) {
        const uid = parsedUids[i];
        const itemEl = document.querySelector(`.uid-item[data-uid="${uid}"] .uid-status`);

        // 更新进度 - 显示百分比
        const percentage = Math.round(((i + 1) / parsedUids.length) * 100);
        progressEl.innerHTML = `⏳ 正在拉黑 ${i + 1}/${parsedUids.length} (${percentage}%): ${uid}`;
        if (itemEl) itemEl.textContent = '⏳ 处理中...';

        try {
            const result = await blockUser(uid);

            if (result.success) {
                successCount++;
                if (itemEl) itemEl.innerHTML = '<span class="status-success">✓ 成功</span>';
            } else {
                failCount++;
                if (itemEl) itemEl.innerHTML = `<span class="status-error">✗ ${result.message}</span>`;
            }
        } catch (error) {
            failCount++;
            if (itemEl) itemEl.innerHTML = `<span class="status-error">✗ 错误</span>`;
        }

        // 实时更新底部状态提示
        showStatus(`⏳ 批量拉黑进度: ${i + 1}/${parsedUids.length} (成功 ${successCount}, 失败 ${failCount})`, 'info', 0);

        // 添加延迟避免频率限制 (每次操作间隔 500ms)
        if (i < parsedUids.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // 完成
    progressEl.innerHTML = `✓ 批量拉黑完成: 成功 ${successCount} 个, 失败 ${failCount} 个`;
    showStatus(`✓ 批量拉黑完成: 成功 ${successCount} 个, 失败 ${failCount} 个`, 'success', 8000);

    // 重新启用按钮
    batchBlockBtn.disabled = false;
    batchUnblockBtn.disabled = false;
}

/**
 * 批量取消拉黑用户
 */
async function handleBatchUnblock() {
    if (parsedUids.length === 0) {
        showStatus('⚠️ 请先解析 UID 列表', 'warning');
        return;
    }

    const progressEl = document.getElementById('batchProgress');
    const batchBlockBtn = document.getElementById('batchBlockBtn');
    const batchUnblockBtn = document.getElementById('batchUnblockBtn');

    // 禁用按钮
    batchBlockBtn.disabled = true;
    batchUnblockBtn.disabled = true;

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < parsedUids.length; i++) {
        const uid = parsedUids[i];
        const itemEl = document.querySelector(`.uid-item[data-uid="${uid}"] .uid-status`);

        // 更新进度 - 显示百分比
        const percentage = Math.round(((i + 1) / parsedUids.length) * 100);
        progressEl.innerHTML = `⏳ 正在取消拉黑 ${i + 1}/${parsedUids.length} (${percentage}%): ${uid}`;
        if (itemEl) itemEl.textContent = '⏳ 处理中...';

        try {
            const result = await unblockUser(uid);

            if (result.success) {
                successCount++;
                if (itemEl) itemEl.innerHTML = '<span class="status-success">✓ 成功</span>';
            } else {
                failCount++;
                if (itemEl) itemEl.innerHTML = `<span class="status-error">✗ ${result.message}</span>`;
            }
        } catch (error) {
            failCount++;
            if (itemEl) itemEl.innerHTML = `<span class="status-error">✗ 错误</span>`;
        }

        // 实时更新底部状态提示
        showStatus(`⏳ 批量取消拉黑进度: ${i + 1}/${parsedUids.length} (成功 ${successCount}, 失败 ${failCount})`, 'info', 0);

        // 添加延迟避免频率限制 (每次操作间隔 500ms)
        if (i < parsedUids.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // 完成
    progressEl.innerHTML = `✓ 批量取消拉黑完成: 成功 ${successCount} 个, 失败 ${failCount} 个`;
    showStatus(`✓ 批量取消拉黑完成: 成功 ${successCount} 个, 失败 ${failCount} 个`, 'success', 8000);

    // 重新启用按钮
    batchBlockBtn.disabled = false;
    batchUnblockBtn.disabled = false;
}
