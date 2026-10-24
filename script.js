if (window.location.hash === '#g') {
    const resetStyle = 'margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;';
    document.documentElement.style.cssText = resetStyle;
    document.body.style.cssText = resetStyle;
    document.body.innerHTML = '<iframe src="gift.html" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; border: none; margin: 0; padding: 0; display: block;"></iframe>';
}