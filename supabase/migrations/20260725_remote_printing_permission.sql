update role_permissions
   set menu_access = coalesce(menu_access, '{}'::jsonb) || '{"/remote-printing": true}'::jsonb
 where role in ('admin', 'manager', 'shipping_manager');
