(frontmatter (frontmatter_js_block) @injection.content
 (#set! injection.language "typescript"))
(attribute_interpolation (attribute_js_expr) @injection.content
 (#set! injection.language "typescript"))
((attribute_backtick_string) @injection.content
 (#set! injection.language "typescript"))
(html_interpolation (permissible_text) @injection.content
 (#set! injection.language "typescript"))
(script_element (raw_text) @injection.content
 (#set! injection.language "typescript"))
(style_element (start_tag) @_start (raw_text) @injection.content
 (#not-match? @_start "lang\\s*=")
 (#set! injection.language "css"))

(style_element
  (start_tag (attribute (attribute_name) @_attribute
    (quoted_attribute_value (attribute_value) @injection.language)))
  (raw_text) @injection.content
  (#eq? @_attribute "lang"))
