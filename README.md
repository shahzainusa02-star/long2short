# Long2Short — GitHub Pages edition

This is a complete browser-only video short maker. It does **not** use Render,
a server, an API key, or cloud video uploads.

This build works with any type of browser-playable video, not only barbershop
content. It selects longer 20–26 second moments from the beginning, middle, and
end of the source, keeps them in source order, preserves original audio, and
uses preloaded joins and dark-frame protection. A 2-minute result uses five
ordered moments rather than repeating an opening teaser.

The default **Skip fast-cut opening previews** option looks for an unusually
rapid opening montage followed by sustained footage. If detected, the short
begins with the main video after that montage. Turn the option off when the
fast opening is important, such as a sports highlight compilation.
If the automatic detection misses an opening, enter **Start after opening**
as `minutes:seconds` (for example `1:18`). This manual start time takes priority
over the automatic checkbox, and the finished result displays the source
timestamps so you can confirm where each chapter came from. The field clears
when you choose a different original video.

The default framing stays closer to the center of the original scene when
automatic face detection is unavailable. Choose **Show the entire original frame** when people, text,
objects, or a process do not fit together in a vertical crop. The completed
result includes an ordered list of source timestamps so you can review the
selection. This browser-only build scores visible activity and picture quality;
it cannot understand the exact meaning of a treatment or identify a client
reliably in every video. Review each result before publishing.

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
6. Preview and download the finished vertical video.

For a two-hour source video, a Mac or Windows computer is recommended. Phones
can process videos too, but available memory and battery vary by device.

The source video stays on the device. Processing cannot continue after the page
is closed. Output is MP4 when the browser supports MP4 recording; otherwise the
app creates WebM.
