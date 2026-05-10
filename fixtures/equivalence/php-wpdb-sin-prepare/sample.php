<?php

function cargar_posts_por_autor($wpdb, $autor_id) {
    return $wpdb->get_results("SELECT * FROM wp_posts WHERE post_author = $autor_id");
}