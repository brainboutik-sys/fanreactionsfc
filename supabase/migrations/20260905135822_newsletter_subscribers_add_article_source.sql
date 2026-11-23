
alter table frfc_newsletter_subscribers drop constraint frfc_newsletter_subscribers_source_check;
alter table frfc_newsletter_subscribers add constraint frfc_newsletter_subscribers_source_check
  check (source in ('site_footer','news_page','article','account','admin'));
