# Long2Short — GitHub Pages edition

This is a browser-only video preview maker. It does **not** use Render,
a server, an API key, or cloud video uploads.

This build works with browser-playable video of any subject, not only barber
content. It makes 1-, 2-, 3-, 4-, or 5-minute fast-cut vertical previews with
original audio. By default, every length (including 1 minute) skips a detected
opening montage and selects scenes across the *full main video* in chronological
order. If the source already contains a rapid opening teaser, you can explicitly
choose to reuse it for a 1-minute preview instead. For 2–5 minute previews,
the app always skips a detected opening teaser so the story doesn't start at
the end and then jump back to the main video. It selects short
shots in source order and reserves roughly the last 10% of each preview for
the source video's ending, including a longer final shot. When the source
has no edited opening, it samples across the entire timeline.

This version checks that sampled frames have been decoded before ranking them,
prefers visible activity or detail over empty shots, searches in narrower
source-time windows to cover shorter stages, and favors different-looking
closing shots. It keeps the actual ending if no suitable final frames were
scanned, rather than assuming an earlier frame must be the reveal. This is based
on pictures and motion only; it works for all subjects, but does not know
the story, identify people reliably on all browsers, or guarantee human edits.
The recorder corrects for small capture gaps as it works. Output lengths may
still vary slightly between devices; preview the downloaded result first.

To keep an already-edited opening in a 1-minute result, select
**Reuse the video's own opening teaser**. Otherwise the app selects from the
full main video. Longer previews always skip a detected teaser automatically.
If automatic detection misses one, expand **Optional: correct the starting
point** and enter where the main video begins as `minutes:seconds` (for example
`1:18`). The manual start overrides the opening setting. The completed
result lists the source timestamps used.

The default framing stays closer to the center of the original scene when
automatic face detection is unavailable. Choose **Show the entire original frame** when people, text,
objects, or a process do not fit together in a vertical crop. The completed
result includes an ordered list of source timestamps so you can review the
selection. Without an already edited teaser, this browser-only build scores
visible activity and picture quality; it cannot understand events or identify
the main subject reliably in every video. It cannot guarantee a human-quality
montage from arbitrary two-hour videos without a video-understanding service
or manual review. Check the output before publishing.

## Put it on GitHub

1. Extract the ZIP.
2. Open your GitHub repository. On GitHub Free, make the repository **Public** first.
3. Choose **Add file → Upload files**.
4. Upload every extracted file directly to the repository root (do not upload the ZIP itself).
5. Commit the files.
6. Open **Settings → Pages**.
7. Under **Build and deployment**, choose **Deploy from a branch**.
8. Select **main**, select **/(root)**, then click **Save**.
9. Wait a few minutes. Your address will be:
   `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`

## Use it

1. Open the public GitHub Pages address in a modern browser.
2. Choose a video.
3. Preview it and choose 1, 2, 3, 4, or 5 minutes.
4. Click **Create**.
5. Keep the page open and the screen awake.
6. Preview and download the finished vertical preview.

For a two-hour source video, a Mac or Windows computer is recommended. Phones
can process videos too, but available memory and battery vary by device.

The source video stays on the device. Processing cannot continue after the page
is closed. Output is MP4 when the browser supports MP4 recording; otherwise the
app creates WebM.
