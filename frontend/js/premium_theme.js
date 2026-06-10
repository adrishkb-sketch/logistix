
document.addEventListener('DOMContentLoaded', () => {
    // 1. Inject Background Blobs and Canvas if not exist
    if (!document.querySelector('.bg-blobs')) {
        const bgBlobs = document.createElement('div');
        bgBlobs.className = 'bg-blobs';
        bgBlobs.innerHTML = '<div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div>';
        document.body.insertBefore(bgBlobs, document.body.firstChild);
    }
    
    if (!document.getElementById('interactive-grid')) {
        const canvas = document.createElement('canvas');
        canvas.id = 'interactive-grid';
        // Insert right after bg-blobs
        const bg = document.querySelector('.bg-blobs');
        if (bg) {
            bg.parentNode.insertBefore(canvas, bg.nextSibling);
        } else {
            document.body.insertBefore(canvas, document.body.firstChild);
        }
    }

    // 2. Physics Dot Grid Initialization
    const canvasBuffer = 400;
    const halfBuffer = canvasBuffer / 2;
    const pointer = { x: -1000, y: -1000 };

    window.addEventListener('mousemove', (e) => {
        pointer.x = e.clientX + halfBuffer;
        pointer.y = e.clientY + halfBuffer;
    });
    window.addEventListener('touchmove', (e) => {
        if(e.touches && e.touches.length > 0) {
            pointer.x = e.touches[0].clientX + halfBuffer;
            pointer.y = e.touches[0].clientY + halfBuffer;
        }
    }, { passive: true });
    window.addEventListener('mouseout', () => { pointer.x = -1000; pointer.y = -1000; });
    window.addEventListener('touchend', () => { pointer.x = -1000; pointer.y = -1000; });

    const mCanvas = document.getElementById('interactive-grid');
    if (mCanvas) {
        const mCtx = mCanvas.getContext('2d', { alpha: true });
        let mWidth, mHeight, mDots = [];
        const mPushRadius = 220, mPushForce = 30, spring = 0.05, friction = 0.8;

        function initGrids() {
            const dpr = window.devicePixelRatio || 1;
            mWidth = window.innerWidth + canvasBuffer;
            mHeight = window.innerHeight + canvasBuffer;

            mCanvas.style.width = mWidth + 'px';
            mCanvas.style.height = mHeight + 'px';
            mCanvas.style.left = `-${halfBuffer}px`;
            mCanvas.style.top = `-${halfBuffer}px`;

            mCanvas.width = mWidth * dpr;
            mCanvas.height = mHeight * dpr;
            mCtx.scale(dpr, dpr);

            const spacing = window.innerWidth < 768 ? 35 : 30;
            mDots = [];
            for (let x = 0; x < mWidth; x += spacing) {
                for (let y = 0; y < mHeight; y += spacing) {
                    mDots.push({ x, y, bx: x, by: y, vx: 0, vy: 0 });
                }
            }
        }

        let resizeTimeout;
        window.addEventListener('resize', () => {
            if (window.innerWidth + 100 > mWidth || window.innerHeight + 100 > mHeight) {
                clearTimeout(resizeTimeout);
                resizeTimeout = setTimeout(initGrids, 200);
            }
        });

        function animateGrids() {
            mCtx.clearRect(0, 0, mWidth, mHeight);
            const isLight = document.body.classList.contains('light-mode');
            mCtx.fillStyle = isLight ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.35)';
            const mPushRadiusSq = mPushRadius * mPushRadius;

            for (let i = 0; i < mDots.length; i++) {
                let p = mDots[i];
                let dx = pointer.x - p.x; let dy = pointer.y - p.y;
                let distSq = dx * dx + dy * dy;

                if (distSq < mPushRadiusSq) {
                    let dist = Math.sqrt(distSq);
                    let force = (mPushRadius - dist) / mPushRadius;
                    p.vx -= (dx / dist) * force * mPushForce;
                    p.vy -= (dy / dist) * force * mPushForce;
                }

                p.vx += (p.bx - p.x) * spring; p.vy += (p.by - p.y) * spring;
                p.vx *= friction; p.vy *= friction;
                p.x += p.vx; p.y += p.vy;
                mCtx.fillRect(p.x, p.y, 2.5, 2.5);
            }
            requestAnimationFrame(animateGrids);
        }
        initGrids(); animateGrids();
    }

    // 3. Automated UI Makeover (Inputs, Modals, Tables, Buttons)
    document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea, select').forEach(el => {
        if(!el.classList.contains('premium-input')) {
            el.classList.add('premium-input');
        }
    });

    document.querySelectorAll('.modal-box').forEach(el => {
        if(!el.classList.contains('modal-glass')) {
            el.classList.add('modal-glass');
        }
    });

    document.querySelectorAll('table').forEach(table => {
        if(!table.parentNode.classList.contains('table-container')) {
            const wrapper = document.createElement('div');
            wrapper.className = 'table-container';
            table.parentNode.insertBefore(wrapper, table);
            wrapper.appendChild(table);
        }
    });

    // 4. Letter Wave Effect for Headings
    const headings = document.querySelectorAll('h1, h2, .main-content h3');
    headings.forEach(heading => {
        if (heading.classList.contains('split-text') || heading.closest('.sidebar') || heading.closest('.modal')) return;
        
        // Preserve any SVGs or inner HTML icons (e.g., manager name highlights)
        // A simple approach: only apply to elements with direct text nodes that are substantial
        let hasText = false;
        for (let node of heading.childNodes) {
            if (node.nodeType === 3 && node.textContent.trim().length > 0) {
                hasText = true; break;
            }
        }
        if(!hasText) return;

        // Save original HTML
        const originalHTML = heading.innerHTML;
        const textContent = heading.innerText;
        
        // Only apply if it's mostly text, avoid messing up complex HTML structures
        if(heading.children.length === 0 || (heading.children.length === 1 && heading.children[0].tagName === 'SPAN')) {
            heading.innerHTML = '';
            heading.classList.add('split-text');
            
            for (let i = 0; i < textContent.length; i++) {
                const char = textContent[i];
                const span = document.createElement('span');
                span.className = 'char';
                span.innerText = char;
                heading.appendChild(span);
            }

            const chars = heading.querySelectorAll('.char');
            heading.addEventListener('mousemove', (e) => {
                const rect = heading.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                
                chars.forEach((charSpan) => {
                    const charRect = charSpan.getBoundingClientRect();
                    const charCenter = charRect.left - rect.left + (charRect.width / 2);
                    const dist = Math.abs(mouseX - charCenter);
                    
                    if (dist < 20) {
                        charSpan.classList.add('hovered');
                        charSpan.classList.remove('neighbor');
                    } else if (dist < 40) {
                        charSpan.classList.add('neighbor');
                        charSpan.classList.remove('hovered');
                    } else {
                        charSpan.classList.remove('hovered', 'neighbor');
                    }
                });
            });
            
            heading.addEventListener('mouseleave', () => {
                chars.forEach(charSpan => {
                    charSpan.classList.remove('hovered', 'neighbor');
                });
            });
        }
    });
});
