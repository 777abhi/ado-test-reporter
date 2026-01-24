@catalog @retail
Feature: Product Catalog and Search
  As a customer
  I want to browse and search for products
  So that I can find items I want to buy

  Background:
    Given the product catalog is updated

  @smoke @TC_837
  Scenario: Search for an existing product
    Given I am on the homepage
    When I search for "Wireless Headphones"
    Then I should see a list of products containing "Headphones"
    And the search results count should be greater than 0

  @TC_838
  Scenario: Filter products by category
    Given I am on the "Electronics" category page
    When I apply the filter "Price: Low to High"
    Then the products should be sorted by price ascending

  @TC_839
  Scenario Outline: View Product Details
    Given I am viewing the search results for "<product>"
    When I click on the product titled "<product>"
    Then I should see the product details page
    And the product price should be visible
    And the "Add to Cart" button should be enabled

    Examples:
      | product             |
      | Noise Cancelling HP |
      | Smartphone X        |
