<?php
$viewFile = __DIR__ . '/' . $view . '.php';
$pageTitle = ($title ?? '글로벌다이렉트') . ' · 글로벌다이렉트';
?>
<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="해외 상품 URL만 입력하면 견적부터 배송까지 한 번에 확인하는 구매대행 서비스">
    <title><?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?></title>
    <link rel="stylesheet" href="/assets/app.css">
    <link rel="stylesheet" href="/assets/account.css">
    <link rel="stylesheet" href="/assets/product.css">
    <script src="/assets/app.js" defer></script>
</head>
<body data-page="<?= htmlspecialchars($view, ENT_QUOTES, 'UTF-8') ?>">
<header class="site-header">
    <a class="brand" href="/" aria-label="글로벌다이렉트 홈"><span>G</span> 글로벌다이렉트</a>
    <nav aria-label="주요 메뉴"><a href="/">상품 찾기</a><a href="/cart">장바구니</a><a href="/orders">주문 조회</a><a href="/account">내 계정</a></nav>
</header>
<main><?php require $viewFile; ?></main>
<footer><strong>글로벌다이렉트</strong><span>국경 너머의 쇼핑을 가장 간단하게.</span><small>© 2026 GlobalDirect. 테스트 서비스</small></footer>
</body>
</html>
