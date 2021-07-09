const fetch = require("node-fetch");
const { parseTweet } = require("./parser");
const { fetchTweetAst } = require("static-tweets");
const Tweet = require("./models/Tweet.schema");
const Meta = require("./models/Meta.schema");

const Logger = require("./logger");

const MAX_RESULTS = 100;

const fetchSearchResults = async (newestID) => {
  const url = `https://api.twitter.com/1.1/search/tweets.json?count=${MAX_RESULTS}&${
    newestID ? `since_id=${newestID}&` : ""
  }q=(("looking for" -job -gig -intern -role -am) OR hiring) remote -podcast -know -how -tips -nobody -anybody -anyone -blog -filter:retweets -filter:quote&tweet_mode=extended&include_entities=false`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: "Bearer " + process.env.BEARER_TOKEN },
  });

  return await res.json();
};

const buildTweetObject = async (tweet) => {
  const [data, tweetAst] = await Promise.all([
    parseTweet(tweet.full_text || tweet.text),
    fetchTweetAst(tweet.id_str),
  ]);

  const obj = {
    type: data.type,
    categories: data.categories,
    roles: data.roles,

    email: data.emails,
    urls: data.urls,

    created_by: tweet.user.name,
    created_on: new Date(tweet.created_at).getTime(),

    need_manual_verification: data.need_manual_verification,

    tweet_id: tweet.id_str,
    tweet_url: `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`,
    author_id: tweet.user.id_str,
    text: data.stripped_text,
    likes: tweet.favorite_count,
    retweets: tweet.retweet_count,
    tweet_ast: tweetAst,
    author_followers: tweet.user.followers_count,
  };

  return obj;
};

const isValid = (tweet) => {
  const followers = tweet.user.followers_count;
  // const accountAge = Date.now() - new Date(status.created_at).getTime();
  // return (followers > 30 && accountAge > 1000 * 60 * 60 * 24 * 30) || followers > 200;
  return followers > 50;
};

const fetchTweets = async () => {
  const newestID = Number((await Meta.findOne({})).sinceId);

  const apiRes = await fetchSearchResults(newestID);
  const tweets = (
    await Promise.allSettled(
      apiRes.statuses.filter(isValid).map(buildTweetObject)
    )
  )
    .filter((result) => result.status == "fulfilled")
    .map((result) => result.value);

  const tweetsFetched = apiRes.statuses.length;
  const tweetsDiscarded = apiRes.statuses.length - tweets.length;
  const maxId = apiRes.search_metadata.max_id;

  console.log("\n### Tweet fetch cycle summary ###");
  Logger.log("api_fetch_count", tweetsFetched);
  Logger.log("filter_discarded_count", tweetsDiscarded);
  Logger.log("db_write_count", tweets.length);
  console.log();

  return { tweets, maxId };
};

const saveTweets = async ({ tweets, maxId }) => {
  console.log(tweets);

  const ops = tweets.map((tweet) => ({
    updateOne: {
      upsert: true,
      filter: { text: tweet.text },
      update: tweet,
    },
  }));

  await Tweet.bulkWrite(ops);
  await Meta.updateOne(
    {},
    { sinceId: String(BigInt(maxId) - (BigInt(1000 * 60 * 10) << BigInt(22))) }
  );

  // console.log(`${nMatch} tweets matched update filter`);
  // console.log(`${nMod} tweets updated`);
  // console.log(`Inserted ${nInsert} new tweets to DB`);
};

module.exports.fetchAndSaveTweets = () => fetchTweets().then(saveTweets);
