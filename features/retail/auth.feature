@auth @retail
Feature: User Authentication
  As a customer
  I want to create an account and log in
  So that I can manage my orders and personal details

  Background:
    Given I am on the home page

  @smoke
  @TC_516899
  Scenario: Successful Login
    When I navigate to the login page
    And I enter valid credentials
      | username      | password |
      | user@test.com | P@ss1234 |
    And I click the "Login" button
    Then I should be redirected to the "My Account" page
    And I should see a welcome message "Welcome, User"

  @TC_615020
  Scenario Outline: Login with invalid credentials
    When I navigate to the login page
    And I enter <username> and <password>
    And I click the "Login" button
    Then I should see an error message "<error>"

    Examples:
      | username        | password  | error                     |
      | user@test.com   | wrongpass | Invalid email or password |
      | unknown@usr.com | anypass   | Account not found         |
      |                 | P@ss1234  | Email is required         |

  @TC_309504
  Scenario: User Registration
    When I navigate to the registration page
    And I fill in the registration form details:
      | First Name | Last Name | Email           | Password  |
      | John       | Doe       | john.d@test.com | SecureP@1 |
    And I submit the form
    Then my account should be created successfully
    And I should be logged in automatically
