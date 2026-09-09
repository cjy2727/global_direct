<?php
$viewFile = __DIR__ . '/' . $view . '.php';
$pageTitle = ($title ?? 'GlobalDirect') . ' · GlobalDirect';
?>
<!doctype html>
<html lang="ja">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="韓国の商品URLを貼るだけ。見積もりから日本への配送まで一つのサービスで。">
    <title><?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?></title>
    <link rel="stylesheet" href="/assets/app.css">
    <script>window.APP = { csrf: <?= json_encode(csrf_token()) ?> };</script>
    <script src="/assets/app.js" defer></script>
</head>
<body data-page="<?= htmlspecialchars($view, ENT_QUOTES, 'UTF-8') ?>">
<header class="site-header">
    <a class="brand" href="/" aria-label="GlobalDirect home"><span>G</span> GlobalDirect</a>
    <nav aria-label="Main navigation">
        <a href="/">見積もり</a>
        <a href="/orders">注文追跡</a>
        <a href="/admin">運営デモ</a>
    </nav>
</header>
<main><?php require $viewFile; ?></main>
<footer><strong>GlobalDirect</strong><span>韓国と日本の買い物を、まっすぐにつなぐ。</span><small>© 2026 GlobalDirect. Demo only.</small></footer>
</body>
</html>
