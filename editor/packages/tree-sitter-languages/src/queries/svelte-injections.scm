((style_element (start_tag) @_start (raw_text) @injection.content)
 (#not-match? @_start "lang\\s*=")
 (#set! injection.language "css"))
((script_element (raw_text) @injection.content)
 (#set! injection.language "typescript"))
((raw_text_expr) @injection.content
 (#set! injection.language "typescript"))
((attribute (attribute_name) @_attr
 (quoted_attribute_value (attribute_value) @injection.content))
 (#eq? @_attr "style")
 (#set! injection.language "css"))

(style_element
  (start_tag (attribute (attribute_name) @_attribute
    (quoted_attribute_value (attribute_value) @injection.language)))
  (raw_text) @injection.content
  (#eq? @_attribute "lang"))
