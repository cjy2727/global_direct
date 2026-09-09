<section class="admin-shell">
    <aside><span class="eyebrow">OPERATIONS</span><h1>注文管理</h1><p>受付から配送完了までの作業キューです。</p><div class="admin-metric"><small>本日の未処理</small><strong id="open-count">—</strong></div><div class="safety-note">実決済・実注文は無効です<br><code>WORKFLOW_STAGE=1</code></div></aside>
    <div class="admin-content"><div class="section-title"><div><h2>注文キュー</h2><p>状態変更は許可された次の段階だけ選択できます。</p></div><button class="secondary" id="refresh-orders">更新</button></div><div id="orders-table" class="table-wrap"><div class="loading">注文を読み込み中...</div></div></div>
</section>
