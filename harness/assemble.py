import sys
js, css, page, out = sys.argv[1:5]
j = open(js).read().replace("</script", "<\\/script")
html = open(page).read().replace("/*__VISUAL_CSS__*/", open(css).read()).replace("/*__VISUAL_JS__*/", j)
open(out, "w").write(html)
