// ==UserScript==
// @name         Meerkat
// @namespace    PROJ_MEERKAT
// @version      0.1
// @description  Hook youtube videos into the meerkat filter
// @author       You
// @match        https://www.youtube.com/watch?*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const SERVICE = 'https://meercat.czhou.dev';
    const VIDEO_EL = document.querySelector('video.video-stream');
    const THRESHOLD = 1;
    const REGION_OVERFLOW = 1.5;
    const REGION_FRONT_TRIM = 1.5;

    function parse_query(search) {
        return Object.fromEntries(search.split('&').map(part => part.split('=')));
    }

    function notify(text, lifetime) {
        let div = document.createElement('div');
        Object.entries({
            position: 'absolute',
            bottom: '0.5em',
            right: '0.5em',
            'min-width': '15em',
            'min-height': '24px',
            padding: '1em',
            'background-color': '#c7254e',
            'font-size': '24px'
        }).forEach(([k,v]) => div.style.setProperty(k, v));
        div.textContent = text;

        document.body.appendChild(div);
        //setTimeout(() => document.body.removeChild(div), lifetime);

        return div;
    }

    function get_timestamps(video_id) {
        return fetch(`${SERVICE}/${video_id}`);
    }

    function find_blurrable(regions) {
        const end = 99999999999;

        let working_blocks = [[false, 0, regions[0][0] - REGION_FRONT_TRIM], [true, regions[0][0] - REGION_FRONT_TRIM, regions[0][0] + REGION_OVERFLOW]];
        for(let i = 1; i < regions.length; i++) {
            if(working_blocks[working_blocks.length-1][2] >= regions[i][0]) {
                working_blocks[working_blocks.length-1][2] = regions[i][0] + REGION_OVERFLOW;
            } else {
                working_blocks.push([false, working_blocks[working_blocks.length-1][2], regions[i][0] - REGION_FRONT_TRIM]);
                working_blocks.push([true, regions[i][0] - REGION_FRONT_TRIM, regions[i][0]+REGION_OVERFLOW])
            }
        }

        if(working_blocks[working_blocks.length-1][2] < end) { working_blocks.push([false, working_blocks[working_blocks.length-1][2], end]); }
        return working_blocks;
    }

    function yt_suspend() {
        VIDEO_EL.pause();
    }

    function yt_resume() {
        VIDEO_EL.currentTime = 0;
        VIDEO_EL.play();
    }

    function get_reason(region) {
        let reason = [];
        if(region[1].racy >= 4 && region[1].adult >= 4) {
            reason.push('Adult');
        }
        if(region[1].Violence !== undefined) {
            reason.push('Violence');
        }

        return reason.join(' & ');
    }

    function reasonify(parts, warnings, fps) {
        let blocks = [];
        let curblock = [];
        let part_i = 0;

        for(let i = 0; i < warnings.length; i++) {
            const warning = warnings[i];

            if(parts[part_i][1] <= warning[0]*fps && warning[0]*fps < parts[part_i][2]) {
                if(parts[part_i][0] == false) { continue; }
                let reason = get_reason(warning);

                if(reason == '') {
                    if(warnings[i-1] === undefined || Math.abs(warnings[i+1][0] - warning[0]) <= REGION_OVERFLOW + 0.001) {
                        reason = get_reason(warnings[i+1]);
                    } else {
                        reason = get_reason(warnings[i-1]);
                    }
                }

                if(!curblock[1] || reason !== curblock[1]) {
                    blocks.push(curblock);
                    curblock = [warning[0], reason];
                }
            } else {
                part_i++;
                i--;
            }
        }

        blocks.shift();

        return blocks;
    }

    function sync_warnings(warning_blocks, div) {
        div.innerHTML = '';
        warning_blocks.forEach(([t, reason]) => {
            let data = {};
             if(t - VIDEO_EL.currentTime < 10 && t - VIDEO_EL.currentTime > 0) {
                 if(reason != '') {
                     if(data[reason] === undefined) { data[reason] = (t+REGION_OVERFLOW) - VIDEO_EL.currentTime; }
                 }
             }

            Object.entries(data).forEach(([r, t]) => div.innerHTML += `${r} in ${Math.ceil(t)}<br>`);
            if(div.innerHTML.trim() == '') { div.style.display = 'none'; }
            else { div.style.display = ''; }
        });
    }

    if(localStorage['MEERCAT_ecs'] === undefined) {
        localStorage['MEERCAT_ecs'] = 1;
    }
    if(localStorage['MEERCAT_icb'] === undefined) {
        localStorage['MEERCAT_icb'] = 1;
    }

    function make_menu_button(cbk) {
        let div = document.createElement('div');
        div.id = 'meercatmenutoggle';
        Object.entries({
            'position': 'absolute',
            'top': '7rem',
            'right': '1rem',
            'height': '5rem',
            'width': '5rem',
            'background-color': 'var(--yt-spec-call-to-action)',
            'color': 'var(--yt-spec-text-primary-inverse)',
            'border-radius': '100%',
            'z-index': '10000',
            'font-weight': 'bold',
            'text-align': 'center',
            'font-size': '3rem',
            'line-height': '5rem',
            'cursor': 'pointer'
        }).forEach(([k,v]) => div.style.setProperty(k, v));

        div.textContent = 'M';

        document.body.appendChild(div);
        div.addEventListener('click', cbk);
    }
    function make_menu() {
        let div = document.createElement('div');
        div.id = 'meercatmenu';
        Object.entries({
            'position': 'absolute',
            'top': '9rem',
            'right': '3.5rem',
            'height': '15rem',
            'width': '25rem',
            'background-color': 'var(--yt-spec-call-to-action)',
            'color': 'var(--yt-spec-text-primary-inverse)',
            'z-index': '9999',
            'font-weight': 'bold',
            'text-align': 'center',
            'font-size': '1.5rem',
            'line-height': '5rem',
            'border-radius': '10% 0 10% 10%/20%',
            'cursor': 'pointer',
            'display': 'none',
            'flex-direction': 'column',
            'justify-content': 'center'
        }).forEach(([k,v]) => div.style.setProperty(k, v));

        div.innerHTML  = `<label><input type="checkbox" id="meercaticb">Inappropriate Content Blurring</label>`
        div.innerHTML += `<label><input type="checkbox" id="meercatecs">Epileptic Content Smoothing</label>`

        document.body.appendChild(div);
    }
    make_menu();
    make_menu_button(evt => {
        let menue = document.querySelector('#meercatmenu');
        menue.style.display = menue.style.display == 'none' ? 'flex' : 'none';
    });

    const icb = document.querySelector('#meercaticb');
    const ecs = document.querySelector('#meercatecs');
    icb.checked = localStorage['MEERCAT_icb'] == 1;
    ecs.checked = localStorage['MEERCAT_ecs'] == 1;

    icb.addEventListener('click', evt => {
        localStorage['MEERCAT_icb'] = icb.checked ? 1 : 0;
        try_attach_video();
    });
    ecs.addEventListener('click', evt => {
        localStorage['MEERCAT_ecs'] = ecs.checked ? 1 : 0;
        try_attach_video();
    });

    function render_wait_badge() {
        let div =  document.createElement('div');
        div.id = 'meercatwait';
        Object.entries({
            'border-radius': '100%',
            'background-color': 'white',
            'height': '20rem',
            'width': '20rem',
            'position': 'absolute',
            'top': '35rem',
            'left': 'calc(50vw - 10rem)',
            'text-align': 'center',
            'box-sizing': 'border-box',
            'padding-top': '4rem',
            'display': 'none'
        }).forEach(([k,v]) => div.style.setProperty(k, v));
        div.innerHTML = '<div style="font-size: 36pt; font-weight: bold">M</div><div style="font-size: 14pt; margin-top: 2rem">Processing Video...</div>';
        document.body.appendChild(div);
    }

    render_wait_badge();

    function try_attach_video() {
        const queries = parse_query(window.location.search.slice(1));
        const url = `https://meercat.czhou.dev/static/${queries.v}-censored-${localStorage['MEERCAT_ecs']}${localStorage['MEERCAT_icb']}.mp4?d=${(new Date()).getTime()}`;

        fetch(url, {'method': 'HEAD'}).then(r => {
            if(r.ok) {
                const ctime = VIDEO_EL.currentTime;
                VIDEO_EL.src = url;
                VIDEO_EL.currentTime = ctime;
                VIDEO_EL.pause();
                VIDEO_EL.play();
            }
        });
    }

    let search = '';
    setInterval(() => {
        if(window.location.search != search) {
            main();
            search = window.location.search;
        }
    }, 1000);
    function main() {
        const queries = parse_query(window.location.search.slice(1));
        const warning_el = notify('', 0);

        let ds = null;
        let swap = false;
        VIDEO_EL.addEventListener('timeupdate', () => {
            if(ds == null) {
                yt_suspend();
            } else {
                if(swap) {
                    sync_warnings(ds[0], warning_el);
                } else { swap = !swap; }
            }
        });



        document.querySelector('#meercatwait').style.display = '';
        fetch(`${SERVICE}/videoRequest/${queries.v}`).then(r => r.json()).then(j => {
            document.querySelector('#meercatwait').style.display = 'none';
            const warnings = j.warning;
            const fps = j.fps;

            const warn_times = warnings.filter(w => w[1].Violence !== undefined || (w[1].racy >= 4 && w[1].adult >= 4));
            let blurrable = [[false, 0, 99999999]];
            try{
                blurrable = find_blurrable(warn_times);
                blurrable.forEach(b => { b[1] = Math.round(b[1] * fps); b[2] = Math.round(b[2] * fps); });
            } catch (e){}

            fetch(`https://meercat.czhou.dev/static/${queries.v}-censored-${localStorage['MEERCAT_ecs']}${localStorage['MEERCAT_icb']}.mp4?d=${(new Date()).getTime()}`, {'method': 'HEAD'}).then(r => {
                if(!r.ok) {
                    document.querySelector('#meercatwait').style.display = '';
                    fetch(`${SERVICE}/censorRequest/${queries.v}/${localStorage['MEERCAT_ecs']}/${localStorage['MEERCAT_icb']}`, {
                        method: 'POST',
                        body: JSON.stringify(blurrable)
                    }).then(r => {
                        document.querySelector('#meercatwait').style.display = 'none';
                        const filtered = `https://meercat.czhou.dev/static/${queries.v}-censored-${localStorage['MEERCAT_ecs']}${localStorage['MEERCAT_icb']}.mp4?d=${(new Date()).getTime()}`;
                        VIDEO_EL.src = filtered;

                        ds = [reasonify(blurrable, warnings, fps), j];
                        yt_resume();
                    });
                } else {
                    const filtered = `https://meercat.czhou.dev/static/${queries.v}-censored-${localStorage['MEERCAT_ecs']}${localStorage['MEERCAT_icb']}.mp4?d=${(new Date()).getTime()}`;
                    VIDEO_EL.src = filtered;

                    ds = [reasonify(blurrable, warnings, fps), j];
                    yt_resume();
                }
            });
        });
    }
})();
