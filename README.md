# ROOP — Live AR Try-On (apna system, koi API nahi)

"Try it on" dabane par camera khulta hai aur hoodie live aap ke jism par nazar aati hai. Sab kuch customer ke phone/laptop par chalta hai: na koi server, na API key, na video upload.

## GitHub Pages par live karna
1. GitHub par naya **public** repo banayein, aur is folder ki saari files (`.nojekyll` aur `sw.js` samet) repo ke **root** mein upload karein.
2. **Settings → Pages** → Branch `main`, folder `/ (root)` → Save.
3. 1–2 minute baad link: `https://<username>.github.io/<repo>/` — mobile par Chrome/Safari mein kholein.

## Kya kya hota hai (realism)
- **Body tracking + person segmentation** (MediaPipe): kandhe, kohniyan, kalaiyan, hips aur aap ke jism ki outline.
- **Silhouette fit**: hoodie ki chaurai aap ke jism ke hisaab se khud barhti hai taa ke aap ke apne kapre peeche se na jhankein. Sleeves ki motai bhi aap ke bazu ke mutabiq.
- **Sir aur haath hoodie ke AAGE** aate hain (jaise asal mein).
- **Room ki roshni**: kamre ki roshni, rang aur saaye hoodie par lagte hain; camera jaisi softness aur grain.
- **Smooth tracking** (One-Euro filter): jitter nahi.

## Load time
- Product/home page khulte hi body-tracking engine background mein download hona shuru ho jata hai, is liye button dabane tak aksar tayyar hota hai. Loading screen par % dikhta hai.
- `sw.js` sab files cache kar leta hai — doosri dafa try-on foran khulta hai.

## Behtar result ke liye
- Phone kisi cheez ke sahare rakhein, 1–2 qadam peeche; sir se kamar tak frame mein.
- Saamne se roshni. Fitting kam/zyada lage to neeche left button se **Fit / Length**.

## Had (honestly)
- Yeh 2D AR hai: seedha camera ki taraf mun kar ke sab se real lagta hai; bilkul side par murne par hoodie flat rahegi.
- Lambi kameez/coat ho to hoodie ke neeche se nazar aa sakti hai.

## Naya kapra add karna
Kapre ki front photo se 3 transparent layers (`torso.png`, `sleeve_r.png`, `sleeve_l.png`) aur us par kandhe/kohni/kalai/hip points (`kp`) chahiye; phir `js/products.js` mein entry add karein.
