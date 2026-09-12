# Long2Short — GitHub Pages edition

This is a browser-only video preview maker. It does **not** use Render,
a server, an API key, or cloud video uploads.

This build works with any type of browser-playable video, not only barbershop
content. It makes a 1-, 2-, 3-, 4-, or 5-minute *preview of the full video*,
not a clip of only the opening. It reserves moments from the beginning, early
process, middle, and ending. These chapters play in original source order,
with original audio. A 2-minute preview has seven chapters. The exact length
of each chapter depends on the chosen preview duration.

The default **Skip fast-cut opening previews** option looks for an unusually
rapid opening montage followed by sustained footage. If detected, the short
begins with the main video after that montage. Turn the option off when the
fast opening is important, such as a sports highlight compilation.
If the automatic detection misses an opening, expand **Optional: correct the starting point** and enter **Start after opening**
as `minutes:seconds` (for example `1:18`). This manual start time takes priority
over the automatic checkbox, and the finished result displays the source
timestamps so you can confirm where each chapter came from. The field clears
when you choose a different original video.

The default framing stays closer to the center of the original scene when
automatic face detection is unavailable. Choose **Show the entire original frame** when people, text,
objects, or a process do not fit together in a vertical crop. The completed
result includes an ordered list of source timestamps so you can review the
selection. This browser-only build uses the timeline, visible activity, and
picture quality; it cannot understand the exact meaning of an event or identify
the main subject reliably in every video. It is a cross-platform preview maker,
not a semantic AI editor. Review each result before publishing.

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
