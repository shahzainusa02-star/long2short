# Long2Short — GitHub Pages edition

This is a browser-only video preview maker. It does **not** use Render,
a server, an API key, or cloud video uploads.

This build works with browser-playable video of any subject, not only barber
content. It makes 1-, 2-, 3-, 4-, or 5-minute fast-cut vertical previews with
original audio. If the source already contains a rapid opening teaser, the
app keeps that teaser by default. On the supplied 51-minute example, a
1-minute preview uses short sections across about the first 68 seconds of
the *existing* fast-cut opening;
this is why its footage resembles the example from the other app. For longer
previews, an opening section is followed by short shots from the rest of the
video in source order. If there is no opening teaser, it selects roughly
54–102 short shots across the source timeline (depending on output length).

To exclude a built-in teaser, select **Skip the video's own opening teaser**.
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
